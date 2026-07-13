# QuimStock

PWA para cadastro e controle de produtos químicos em estoque usando a câmera do celular, OCR, armazenamento offline e exportação para Excel.

## MVP atual

- Captura de foto do rótulo pela câmera traseira do celular
- OCR para sugerir nome do produto, Ecode, lote e validade
- Conferência manual obrigatória antes de salvar
- Cadastro, edição, exclusão e pesquisa
- Armazenamento local com IndexedDB
- Indicadores de produtos vencidos e próximos do vencimento
- Exportação do estoque para arquivo `.xlsx`
- Instalação como PWA e funcionamento offline após o primeiro carregamento
- Build automático e publicação pelo GitHub Pages

## Tecnologias

- React + TypeScript
- Vite
- Tesseract.js
- IndexedDB
- SheetJS

## Executar localmente

```bash
npm install
npm run dev
```

Para gerar a versão de produção:

```bash
npm run build
npm run preview
```

## Publicação

A cada alteração aprovada e enviada para a branch `main`, o GitHub Actions valida o projeto e publica a pasta `dist` no GitHub Pages.

Endereço previsto:

```text
https://carvalho832-glitch.github.io/estoque-quimico-pwa/
```

## Segurança

Este repositório é público. Não adicione planilhas reais, credenciais, chaves, nomes de clientes ou dados internos da empresa.

## Observação sobre OCR

Na primeira leitura, o Tesseract pode precisar baixar os dados do idioma. A imagem e os campos extraídos devem sempre ser conferidos antes do salvamento.

## Próximas etapas

1. Validar a leitura com rótulos reais usando dados não sigilosos.
2. Ajustar os padrões de Ecode, lote e validade.
3. Importar planilhas existentes.
4. Adicionar sincronização em nuvem e usuários.
5. Criar histórico de entrada, saída e alterações.
