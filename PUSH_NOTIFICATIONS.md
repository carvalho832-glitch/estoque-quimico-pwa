# QuimStock - Configurações administrativas e Push Notifications

## Visão geral

O QuimStock possui duas camadas complementares de notificação:

1. **Cliente/PWA**: verifica o estoque enquanto o app está ativo e exibe notificações do sistema Android pelo Service Worker.
2. **Backend Firebase**: registra os dispositivos autenticados, sincroniza as preferências do usuário e executa verificações na nuvem mesmo quando o PWA está fechado.

As notificações operacionais continuam fora do Dashboard: não existe sino, caixa de entrada ou central interna persistente.

## Área administrativa

A engrenagem discreta no canto superior direito abre a autenticação da Área Administrativa. O PIN inicial de bootstrap é `1793`. Na primeira utilização ele é convertido para PBKDF2-SHA-256 com salt aleatório e 210.000 iterações. Somente salt, parâmetros e hash são persistidos no dispositivo.

As preferências administrativas ficam em armazenamento local versionado (`settingsVersion: 1`) e também são sincronizadas, quando há login e internet, para:

```text
users/{uid}/settings/notifications
```

A exportação de configurações não contém o PIN nem o hash do PIN.

## Registro de dispositivos

Depois que o usuário concede permissão e o FCM fornece um token, o QuimStock registra esse dispositivo em:

```text
users/{uid}/pushTokens/{sha256-do-token}
```

O token não é usado como ID de documento. O ID é um SHA-256 determinístico. O documento guarda o token necessário ao FCM, plataforma, escopo do Service Worker, agente do navegador e data de atualização.

As regras do Firestore permitem que cada usuário gerencie somente os próprios tokens. Tokens inválidos ou expirados são removidos automaticamente pelo backend quando o FCM devolve os códigos correspondentes.

## Serviços do cliente

- `SettingsService`: defaults, persistência, importação/exportação e sincronização das preferências com o Firestore.
- `PinService`: criação/validação do hash do PIN e troca de PIN.
- `NotificationRules`: regras puras de validade e deduplicação usadas pelo cliente.
- `NotificationService`: conteúdo das notificações locais e deduplicação no dispositivo.
- `NotificationScheduler`: verificações locais enquanto o PWA está ativo.
- `PushService`: permissão, token FCM, registro do token no Firestore, renovação, mensagens em foreground e teste remoto.
- `CloudNotificationBridge`: sincroniza token e preferências após login e reconexão da internet.

## Backend Firebase

O backend fica em `functions/` e usa Node.js 22, Firebase Functions v2 e Firebase Admin SDK.

### `backgroundNotificationSweep`

É executada a cada 5 minutos. Para cada usuário que possui dispositivo com push ativo:

- carrega as preferências da nuvem;
- respeita `checkTimes` e o timezone do usuário;
- aceita horários personalizados com uma janela máxima de 5 minutos;
- verifica produtos próximos do vencimento;
- verifica produtos vencidos;
- verifica estoque baixo;
- aplica deduplicação antes do envio.

Os estágios de validade permanecem separados, por exemplo:

```text
produtoId:expiration:2026-10-10:30
produtoId:expiration:2026-10-10:15
produtoId:expiration:2026-10-10:7
produtoId:expiration:2026-10-10:3
produtoId:expiration:2026-10-10:1
produtoId:expired:2026-10-10
```

### `productNotificationBridge`

É acionada por alterações reais em:

```text
users/{uid}/products/{productId}
```

Ela detecta:

- retirada do material para uso;
- devolução ao estoque;
- entrada em estoque baixo;
- normalização do estoque baixo.

Quando a quantidade volta acima do limite, a chave de estoque baixo é apagada do histórico do servidor. Assim uma futura nova queda pode alertar novamente.

### `sendPushTest`

Callable Function autenticada usada pelo botão **Testar push remoto** da Área Administrativa. Ela só aceita usuários logados e envia para os dispositivos registrados daquele próprio usuário.

## Deduplicação do backend

O backend usa:

```text
users/{uid}/notificationDelivery/{sha256-da-chave-do-evento)}
```

Essa coleção é **server-only**. As regras do Firestore negam qualquer leitura ou escrita feita pelo cliente.

Antes de enviar, a Function cria uma reserva `pending`. Isso reduz corridas entre a rotina agendada e o gatilho de produto. Quando pelo menos um dispositivo confirma o envio, a reserva vira `sent`. Se todos os envios falham, a reserva é liberada para nova tentativa.

## Firebase Cloud Messaging e VAPID

O Web Push requer uma chave pública VAPID associada ao projeto Firebase. No build do GitHub Pages ela é fornecida por:

```text
VITE_FIREBASE_VAPID_KEY
```

A chave VAPID pública pode ficar em GitHub Actions **Variables**; ela não é uma credencial administrativa. Service accounts, chaves privadas e credenciais IAM nunca devem ir para o bundle do PWA.

## Deploy do backend

O projeto possui:

```text
firebase.json
.firebaserc
.github/workflows/firebase-backend.yml
```

O workflow é manual (`workflow_dispatch`) e publica somente:

```text
functions
firestore:rules
```

Ele exige o GitHub Secret:

```text
FIREBASE_SERVICE_ACCOUNT_QUIMSTOCK
```

O conteúdo desse secret deve ser o JSON de uma service account autorizada a fazer deploy no projeto Firebase `quimstock`.

O projeto Firebase precisa estar no plano **Blaze**, pois Cloud Functions e Cloud Scheduler exigem billing habilitado. Também deve estar habilitada a Cloud Scheduler API.

## Service Worker

`public/sw.js` continua responsável pelo cache/offline e também trata:

- evento `push`;
- exibição da notificação do sistema;
- `notificationclick`;
- foco em uma janela já aberta do próprio QuimStock;
- abertura do PWA quando necessário.

## Testes

O cliente continua executando `npm test` e `npm run build`.

O backend executa:

```text
npm --prefix functions install
npm --prefix functions test
```

Os testes do backend cobrem:

- normalização de configurações;
- horários personalizados;
- janela de 5 minutos;
- virada de dia;
- cálculo de vencimento por timezone;
- estágios de validade;
- limite de estoque específico por produto;
- retirada e devolução reais.

O teste também carrega `functions/index.js` por completo para detectar problemas de inicialização/definição das Functions antes do merge.

## Android

Esta infraestrutura de push é para o **PWA instalado pelo navegador Android**. O workflow Android continua validando que as alterações não quebram o projeto Capacitor/APK, mas push nativo dentro do APK é uma integração separada.

## Checklist para ativação em produção

- Firebase `quimstock` no plano Blaze.
- Cloud Scheduler API habilitada.
- Par VAPID Web Push gerado/importado no Firebase Cloud Messaging.
- `VITE_FIREBASE_VAPID_KEY` preenchida nas GitHub Actions Variables.
- Service account de deploy criada com permissões adequadas.
- JSON da service account armazenado somente no secret `FIREBASE_SERVICE_ACCOUNT_QUIMSTOCK`.
- Workflow `Publicar backend Firebase` executado com sucesso.
- Abrir QuimStock no Android, entrar na conta e ativar notificações.
- Confirmar status **Token: registrado na nuvem**.
- Usar **Testar push remoto**.
- Fechar o PWA e validar uma notificação real de background.
