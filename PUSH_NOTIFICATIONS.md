# QuimStock - Configurações administrativas e Push Notifications

## Área administrativa

A engrenagem discreta no canto superior direito abre a autenticação da Área Administrativa. O PIN inicial de bootstrap é `1793`. Na primeira utilização ele é convertido para PBKDF2-SHA-256 com salt aleatório e 210.000 iterações. Somente salt, parâmetros e hash são persistidos no dispositivo.

As preferências administrativas ficam em armazenamento local versionado (`settingsVersion: 1`) e podem ser exportadas/importadas em JSON. A exportação de configurações não contém o PIN nem o hash do PIN.

## Serviços

A implementação é separada em:

- `SettingsService`: defaults, persistência, importação e exportação das preferências.
- `PinService`: criação e validação do hash do PIN e troca de PIN.
- `NotificationService`: conteúdo das notificações, envio pelo sistema operacional e deduplicação.
- `NotificationScheduler`: horários de verificação, validade e estoque baixo.
- `PushService`: permissão, token FCM, renovação e ponte de mensagens recebidas com o app aberto.

## Firebase Cloud Messaging

O projeto já utiliza Firebase. Para habilitar a aquisição do token Web Push, configure também:

```text
VITE_FIREBASE_VAPID_KEY=<chave publica Web Push do Firebase>
```

No GitHub Pages, crie a variável de repositório `VITE_FIREBASE_VAPID_KEY`. O workflow já expõe essa variável para o build.

O token FCM fica somente no dispositivo nesta etapa. O envio remoto deve registrar o token em um backend autenticado antes de enviar mensagens. Não coloque service accounts, chaves privadas ou credenciais administrativas no PWA.

## Service Worker

`public/sw.js` continua responsável pelo cache/offline do PWA e agora também trata:

- evento `push` para exibir notificação do sistema Android;
- evento `notificationclick` para focar uma janela existente ou abrir o QuimStock;
- payload com `title`, `body`, `url` e `notificationKey` em `data`.

O cache foi atualizado para `quimstock-v58`.

## Deduplicação

Notificações de validade usam chave determinística por produto, validade e estágio. Exemplo:

```text
produtoId:expiration:2026-10-10:7
```

O mesmo estágio não é reenviado. Uma validade diferente pode gerar novos estágios normalmente.

Estoque baixo mantém estado por produto. Ao cruzar o limite para baixo, envia uma vez. Enquanto continuar abaixo, não repete. Quando o estoque volta acima do limite, o estado é normalizado e uma futura queda pode gerar novo alerta.

## Scheduler

Os horários configuráveis são verificados no cliente enquanto o PWA está ativo. Um PWA fechado não possui garantia de executar JavaScript exatamente às 08:00, 12:00, 18:00 ou 22:00.

Para notificações garantidas em background, o backend deve executar a regra de vencimento/estoque, aplicar a mesma chave de deduplicação e enviar via FCM. A infraestrutura de recepção no PWA já está preparada.

## Android

A permissão é solicitada somente por ação do usuário na Área Administrativa. Se o Android/navegador retornar `denied`, o QuimStock mostra o aviso apenas dentro da tela de configurações. Não existe API Web universal e segura para abrir diretamente a tela de permissões do Android, por isso o botão informa o caminho de configuração quando o acesso direto não está disponível.

As notificações operacionais não são renderizadas no Dashboard nem em uma central interna. Elas usam `ServiceWorkerRegistration.showNotification` e aparecem na área de notificações do sistema quando a plataforma permite.

## Backup

`Backup manual` reutiliza a exportação Excel existente. `Restaurar Backup` encaminha o operador para o painel seguro de restauração já existente, preservando as validações atuais do Firebase.

## Limites desta etapa

- O repositório não possui backend/Cloud Functions de envio FCM. O cliente está preparado para receber push e obter token, mas um remetente autenticado ainda precisa ser configurado para notificações com o PWA totalmente fechado.
- O `package.json` atual não possui scripts de lint ou testes automatizados. O CI existente valida `npm install` e `npm run build` em Pull Requests.
- A versão Capacitor/APK é uma aplicação nativa WebView. Esta implementação é de Web Push para o PWA instalado pelo navegador Android. Push nativo do APK exigiria a integração específica do Capacitor/FCM e deve ser tratada separadamente.
