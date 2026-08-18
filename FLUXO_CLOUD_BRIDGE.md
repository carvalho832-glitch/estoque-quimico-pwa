# Integração com o Fluxo

O projeto Firebase do QuimStock também é usado pelo Fluxo para backup autenticado.

Documentos reservados do Fluxo usam o prefixo `__fluxo_backup_` dentro da coleção privada do usuário. O QuimStock deve ignorar esses documentos ao listar e sincronizar produtos.
