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

## 4. Criar e proteger o Firestore

1. Abra **Firestore Database**.
2. Clique em **Criar banco de dados**.
3. Escolha o modo de produção.
4. Selecione uma região adequada para o Brasil.
5. Na aba **Regras**, substitua o conteúdo pelo arquivo `firestore.rules` deste repositório e publique.

> Importante: alterar `firestore.rules` no GitHub não publica automaticamente as regras no Firebase. Sempre que esse arquivo mudar, publique a nova versão também no Firebase Console. As regras atuais exigem o protocolo de sincronização do QuimStock para novas gravações e ajudam a bloquear clientes antigos.

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

## 6. Primeiro acesso e sincronização segura

1. Abra o QuimStock no celular ou computador.
2. Entre com a mesma conta usada para o estoque.
3. Quando há internet, o Firestore é a fonte oficial: o aplicativo baixa o estoque atual e substitui o cache local deste usuário antes de liberar a tela.
4. Dados antigos do IndexedDB não são enviados automaticamente durante um login normal.
5. Se a conta na nuvem estiver realmente vazia e o aparelho possuir dados de uma versão anterior, o QuimStock mostrará uma escolha explícita:
   - **Usar estoque da nuvem**, opção segura recomendada;
   - **Importar dados locais**, somente quando o usuário confirmar que aqueles registros são o estoque correto.
6. No modo offline, apenas alterações realmente feitas offline entram na fila de sincronização. O cache inteiro não é reenviado ao Firestore.

## 7. Android

A versão de sincronização segura é a **1.3.2** (`versionCode 6`). Evite manter versões Android anteriores conectadas ao estoque compartilhado. Após publicar as regras atuais do Firestore, clientes antigos não conseguem criar ou atualizar produtos sem o protocolo de sincronização exigido.

## Estrutura dos dados

Cada usuário possui uma coleção própria na nuvem:

`users/{uid}/products/{productId}`

No dispositivo, o cache IndexedDB também é separado por UID e possui uma fila independente de operações offline.

As regras impedem que um usuário leia ou altere o estoque de outro usuário e exigem o protocolo de sincronização atual para criação/atualização de produtos.
