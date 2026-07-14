# Configurar sincronização do QuimStock

## 1. Criar o projeto

1. Acesse o Firebase Console.
2. Crie um projeto chamado `QuimStock`.
3. O Google Analytics é opcional para este aplicativo.

## 2. Registrar o aplicativo Web

1. Na página inicial do projeto, escolha o ícone Web `</>`.
2. Nome sugerido: `QuimStock Web`.
3. Não é necessário ativar Firebase Hosting, pois o app continua no GitHub Pages.
4. Copie o objeto `firebaseConfig` exibido.

## 3. Ativar login

1. Abra **Authentication**.
2. Clique em **Começar**.
3. Em **Método de login**, habilite **E-mail/senha**.

## 4. Criar o Firestore

1. Abra **Firestore Database**.
2. Clique em **Criar banco de dados**.
3. Escolha o modo de produção.
4. Selecione uma região adequada para o Brasil.
5. Na aba **Regras**, substitua o conteúdo pelo arquivo `firestore.rules` deste repositório e publique.

## 5. Configurar o GitHub Pages

No repositório GitHub, abra:

`Settings > Secrets and variables > Actions > Variables`

Crie estas variáveis usando os valores do objeto `firebaseConfig`:

| Variável GitHub | Campo Firebase |
|---|---|
| `VITE_FIREBASE_API_KEY` | `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `VITE_FIREBASE_PROJECT_ID` | `projectId` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `storageBucket` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `VITE_FIREBASE_APP_ID` | `appId` |

Depois, execute novamente o workflow **Validar e publicar QuimStock** ou faça uma nova publicação.

## 6. Primeiro acesso

1. Abra o QuimStock no celular.
2. Toque em **Criar conta**.
3. Entre com o mesmo e-mail no painel do computador.
4. No primeiro acesso, os produtos que já estavam salvos localmente serão enviados para a nuvem.

## Estrutura dos dados

Cada usuário possui uma coleção própria:

`users/{uid}/products/{productId}`

As regras impedem que um usuário leia ou altere o estoque de outro usuário.
