import { useEffect, useMemo, useState } from 'react';
import { listProducts } from './lib/db';
import { exportProductsToPdf } from './lib/excel';
import { daysUntilExpiry, formatDate, getExpiryLabel, getExpiryLevel } from './lib/expiry';
import type { ExpiryLevel, Product } from './types';
import './dashboard.css';

type StatusFilter = 'all' | 'expired' | 'critical' | 'warning' | 'valid';
type AvailabilityFilter = 'all' | 'stock' | 'in-use';
type SortKey = 'expiry' | 'name' | 'location' | 'updated';

function statusLabel(level: ExpiryLevel): string {
  if (level === 'expired') return 'Vencido';
  if (level === 'critical') return 'Até 30 dias';
  if (level === 'warning') return '31 a 90 dias';
  if (level === 'valid') return 'Acima de 90 dias';
  return 'Sem validade';
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Não informado';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function productIsInUse(product: Product): boolean {
  return product.availabilityStatus === 'in-use' && Boolean(product.currentUsage);
}

function compareProducts(a: Product, b: Product, sortKey: SortKey): number {
  if (sortKey === 'name') return a.name.localeCompare(b.name, 'pt-BR');
  if (sortKey === 'location') {
    return (a.location || 'ZZZ').localeCompare(b.location || 'ZZZ', 'pt-BR') || a.name.localeCompare(b.name, 'pt-BR');
  }
  if (sortKey === 'updated') return b.updatedAt.localeCompare(a.updatedAt);

  const aDays = daysUntilExpiry(a.expiryDate) ?? Number.MAX_SAFE_INTEGER;
  const bDays = daysUntilExpiry(b.expiryDate) ?? Number.MAX_SAFE_INTEGER;
  return aDays - bDays || a.name.localeCompare(b.name, 'pt-BR');
}

export default function Dashboard() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('expiry');

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      setProducts(await listProducts());
    } catch (loadError) {
      console.error(loadError);
      setError('Não foi possível carregar o estoque deste computador.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const locations = useMemo(() => {
    return [...new Set(products.map((product) => product.location.trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [products]);

  const stats = useMemo(() => {
    const expired = products.filter((product) => getExpiryLevel(product.expiryDate) === 'expired').length;
    const critical = products.filter((product) => getExpiryLevel(product.expiryDate) === 'critical').length;
    const warning = products.filter((product) => getExpiryLevel(product.expiryDate) === 'warning').length;
    const locationsCount = new Set(products.map((product) => product.location.trim()).filter(Boolean)).size;
    const inUse = products.filter(productIsInUse).length;

    return {
      products: products.length,
      units: products.reduce((total, product) => total + product.quantity, 0),
      expired,
      critical,
      warning,
      locations: locationsCount,
      inUse,
    };
  }, [products]);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR');

    return products
      .filter((product) => {
        const matchesQuery = !normalizedQuery || [
          product.name,
          product.ecode,
          product.batch,
          product.docmat,
          product.location,
          product.currentUsage?.workOrder,
          product.currentUsage?.aircraft,
          product.currentUsage?.operator,
        ]
          .join(' ')
          .toLocaleLowerCase('pt-BR')
          .includes(normalizedQuery);

        const level = getExpiryLevel(product.expiryDate);
        const matchesStatus = statusFilter === 'all' || level === statusFilter;
        const availability = productIsInUse(product) ? 'in-use' : 'stock';
        const matchesAvailability = availabilityFilter === 'all' || availability === availabilityFilter;
        const matchesLocation = locationFilter === 'all' || product.location === locationFilter;

        return matchesQuery && matchesStatus && matchesAvailability && matchesLocation;
      })
      .sort((a, b) => compareProducts(a, b, sortKey));
  }, [products, query, statusFilter, availabilityFilter, locationFilter, sortKey]);

  const priorityProducts = useMemo(() => {
    return [...products]
      .filter((product) => ['expired', 'critical', 'warning'].includes(getExpiryLevel(product.expiryDate)))
      .sort((a, b) => compareProducts(a, b, 'expiry'))
      .slice(0, 6);
  }, [products]);

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="dashboard-brand">
          <span className="dashboard-brand-mark">QS</span>
          <div>
            <strong>QuimStock</strong>
            <small>Painel de controle</small>
          </div>
        </div>

        <nav className="dashboard-nav" aria-label="Navegação do painel">
          <a className="active" href="?view=dashboard">▦ Visão geral</a>
          <a href="./">▣ Operação e QR</a>
        </nav>

        <div className="dashboard-storage-status">
          <span>● Nuvem ativa</span>
          <p>Celular e computador compartilham o mesmo estoque e os mesmos status de uso.</p>
        </div>
      </aside>

      <main className="dashboard-main">
        <header className="dashboard-header">
          <div>
            <span className="dashboard-kicker">CONTROLE DE ESTOQUE QUÍMICO</span>
            <h1>Painel do estoque</h1>
            <p>Acompanhe validade, localização e materiais atualmente em uso.</p>
          </div>
          <div className="dashboard-header-actions">
            <button type="button" className="dashboard-button secondary" onClick={() => void refresh()}>
              ↻ Atualizar
            </button>
            <button
              type="button"
              className="dashboard-button primary"
              onClick={() => exportProductsToPdf(products)}
              disabled={!products.length}
            >
              Gerar PDF
            </button>
          </div>
        </header>

        <section className="dashboard-sync-banner">
          <div>
            <strong>Sincronização em nuvem ativa</strong>
            <p>Retiradas e devoluções registradas no celular aparecem neste painel.</p>
          </div>
          <span className="active">Conectado</span>
        </section>

        <section className="dashboard-stats" aria-label="Indicadores do estoque">
          <article>
            <span>Produtos</span>
            <strong>{stats.products}</strong>
            <small>{stats.units} unidade(s)</small>
          </article>
          <article className="usage">
            <span>Em uso</span>
            <strong>{stats.inUse}</strong>
            <small>Fora do estoque</small>
          </article>
          <article className="danger">
            <span>Vencidos</span>
            <strong>{stats.expired}</strong>
            <small>Exigem ação imediata</small>
          </article>
          <article className="critical">
            <span>Até 30 dias</span>
            <strong>{stats.critical}</strong>
            <small>Prioridade alta</small>
          </article>
          <article className="warning">
            <span>31 a 90 dias</span>
            <strong>{stats.warning}</strong>
            <small>Em acompanhamento</small>
          </article>
          <article>
            <span>Locais</span>
            <strong>{stats.locations}</strong>
            <small>Prateleiras cadastradas</small>
          </article>
        </section>

        <section className="dashboard-grid">
          <article className="dashboard-card priority-card">
            <div className="dashboard-card-title">
              <div>
                <span>ATENÇÃO</span>
                <h2>Próximos vencimentos</h2>
              </div>
              <strong>{priorityProducts.length}</strong>
            </div>

            {priorityProducts.length === 0 ? (
              <p className="dashboard-empty">Nenhum produto em situação de atenção.</p>
            ) : (
              <div className="priority-list">
                {priorityProducts.map((product) => {
                  const level = getExpiryLevel(product.expiryDate);
                  return (
                    <div className="priority-item" key={product.id}>
                      <span className={`dashboard-status-dot ${level}`} />
                      <div>
                        <strong>{product.name}</strong>
                        <small>{product.ecode} · Lote {product.batch}</small>
                      </div>
                      <span className={`dashboard-status ${level}`}>{getExpiryLabel(product.expiryDate)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </article>

          <article className="dashboard-card distribution-card">
            <div className="dashboard-card-title">
              <div>
                <span>DISTRIBUIÇÃO</span>
                <h2>Situação das validades</h2>
              </div>
            </div>
            <div className="distribution-list">
              {([
                ['expired', stats.expired],
                ['critical', stats.critical],
                ['warning', stats.warning],
                ['valid', products.filter((product) => getExpiryLevel(product.expiryDate) === 'valid').length],
              ] as Array<[ExpiryLevel, number]>).map(([level, count]) => {
                const percentage = products.length ? Math.round((count / products.length) * 100) : 0;
                return (
                  <div className="distribution-row" key={level}>
                    <div><span>{statusLabel(level)}</span><strong>{count}</strong></div>
                    <div className="distribution-track"><span className={level} style={{ width: `${percentage}%` }} /></div>
                  </div>
                );
              })}
            </div>
          </article>
        </section>

        <section className="dashboard-card inventory-table-card">
          <div className="dashboard-card-title table-title">
            <div>
              <span>INVENTÁRIO</span>
              <h2>Materiais cadastrados</h2>
            </div>
            <strong>{filteredProducts.length} resultado(s)</strong>
          </div>

          <div className="dashboard-filters">
            <label className="dashboard-search">
              <span>⌕</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar produto, Ecode, lote, OM, avião ou operador"
              />
            </label>

            <select value={availabilityFilter} onChange={(event) => setAvailabilityFilter(event.target.value as AvailabilityFilter)}>
              <option value="all">Estoque e em uso</option>
              <option value="stock">Somente no estoque</option>
              <option value="in-use">Somente em uso</option>
            </select>

            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
              <option value="all">Todas as validades</option>
              <option value="expired">Vencidos</option>
              <option value="critical">Até 30 dias</option>
              <option value="warning">31 a 90 dias</option>
              <option value="valid">Acima de 90 dias</option>
            </select>

            <select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>
              <option value="all">Todos os locais</option>
              {locations.map((location) => <option key={location} value={location}>{location}</option>)}
            </select>

            <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
              <option value="expiry">Ordenar por vencimento</option>
              <option value="name">Ordenar por produto</option>
              <option value="location">Ordenar por local</option>
              <option value="updated">Últimos atualizados</option>
            </select>
          </div>

          {loading ? (
            <p className="dashboard-empty">Carregando estoque...</p>
          ) : error ? (
            <p className="dashboard-empty dashboard-error">{error}</p>
          ) : filteredProducts.length === 0 ? (
            <p className="dashboard-empty">Nenhum material encontrado com os filtros selecionados.</p>
          ) : (
            <div className="dashboard-table-wrap">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Status</th>
                    <th>Ecode</th>
                    <th>Lote</th>
                    <th>DV</th>
                    <th>Restante</th>
                    <th>Uso atual</th>
                    <th>Qtd.</th>
                    <th>Local</th>
                    <th>Atualizado</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((product) => {
                    const level = getExpiryLevel(product.expiryDate);
                    const inUse = productIsInUse(product);
                    return (
                      <tr key={product.id} className={inUse ? 'dashboard-row-in-use' : ''}>
                        <td><strong>{product.name}</strong>{product.docmat && <small>Docmat {product.docmat}</small>}</td>
                        <td>
                          <span className={`dashboard-availability ${inUse ? 'in-use' : 'stock'}`}>
                            {inUse ? 'Em uso' : 'Estoque'}
                          </span>
                        </td>
                        <td>{product.ecode}</td>
                        <td>{product.batch}</td>
                        <td>{formatDate(product.expiryDate)}</td>
                        <td><span className={`dashboard-status ${level}`}>{getExpiryLabel(product.expiryDate)}</span></td>
                        <td>
                          {inUse && product.currentUsage ? (
                            <div className="dashboard-usage-cell">
                              <strong>{product.currentUsage.workOrder}</strong>
                              <span>{product.currentUsage.aircraft}</span>
                              <small>{product.currentUsage.operator} · desde {formatUpdatedAt(product.currentUsage.startedAt)}</small>
                            </div>
                          ) : (
                            <span className="dashboard-available-text">Disponível</span>
                          )}
                        </td>
                        <td>{product.quantity}</td>
                        <td>{product.location || 'Não informado'}</td>
                        <td>{formatUpdatedAt(product.updatedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
