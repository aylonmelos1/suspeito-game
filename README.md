# 🕵️‍♂️ Suspeito Game

> **Descubra o culpado.**  
> Um jogo de dedução multiplayer em tempo real, onde cada pista conta e ninguém é confiável até que se prove o contrário.

![Suspeito Game Banner](public/icon-192.png) <!-- Substitua por um banner real se tiver -->

## 📖 Sobre o Projeto

**Suspeito** é uma versão moderna e interativa de jogos clássicos de tabuleiro de mistério (inspirado em *Clue* / *Detetive*). Desenvolvido com tecnologias web modernas, o jogo oferece uma experiência fluida tanto para partidas rápidas com amigos quanto para jogatinas offline.

O objetivo é simples: deduzir quem cometeu o crime, com qual arma e em que local. Use seu bloco de notas digital para eliminar suspeitos e faça sua acusação final antes dos outros detetives!

## ✨ Funcionalidades

- **🎭 Multiplayer em Tempo Real**: Jogue com amigos criando ou entrando em salas privadas. Sincronização instantânea de ações via Socket.IO.
- **🎲 Modo Offline**: Pratique suas habilidades de dedução jogando sozinho contra a lógica do jogo.
- **📱 Progressive Web App (PWA)**: Instale o jogo no seu celular ou desktop como um aplicativo nativo. Funciona offline!
- **📝 Bloco de Notas Inteligente**: Marque suas descobertas diretamente na interface do jogo.
- **👀 Spy Mode**: Modo espectador para acompanhar partidas em andamento (configurável).

## 🚀 Tecnologias Utilizadas

O projeto utiliza um stack moderno e eficiente:

- **Backend**:
  - [Node.js](https://nodejs.org/) & [Express](https://expressjs.com/)
  - [Socket.IO](https://socket.io/) (Comunicação Real-time)
  - [SQLite](https://www.sqlite.org/) (Persistência de dados leve)
  - [TypeScript](https://www.typescriptlang.org/) (Segurança de tipos)

- **Frontend**:
  - HTML5 & CSS3 (Design responsivo e animações)
  - JavaScript (Vanilla + Lógica de cliente Socket.IO)
  - PWA (Service Workers, Manifest)

## 🛠️ Como Rodar o Projeto

Siga os passos abaixo para executar o projeto em sua máquina local:

### Pré-requisitos
- [Node.js](https://nodejs.org/) (v18 ou superior recomendado)
- NPM (geralmente vem com o Node.js)

### Passos

1. **Clone o repositório**
   ```bash
   git clone https://github.com/seu-usuario/suspeito-game.git
   cd suspeito-game
   ```

2. **Instale as dependências**
   ```bash
   npm install
   ```

3. **Inicie o servidor de desenvolvimento**
   ```bash
   npm run dev
   ```
   Isso iniciará o servidor com *hot-reload* usando `tsx`.

4. **Acesse o jogo**
   Abra seu navegador e vá para: `http://localhost:3000`

### Build para Produção

Para gerar a versão otimizada para produção:

```bash
npm run build
npm start
```

## 🎮 Como Jogar

1. **Escolha o Modo**: "Com Amigos" para online ou "Offline" para local.
2. **Lobby**: 
   - Se online, crie uma sala ou entre em uma existente com o código.
   - Escolha seu apelido.
3. **O Jogo**:
   - Vá para o local do crime, faça sugestões envolvendo um suspeito e uma arma.
   - Outros jogadores tentarão refutar sua sugestão se tiverem cartas que provem o contrário.
   - Use o bloco de notas para marcar quem *não* é o culpado.
4. **Acusação**: Quando tiver certeza, vá ao local central e faça a **Acusação Final**. Se acertar, você vence! Se errar, está fora do caso.

---

Desenvolvido com 🕵️‍♂️ por [Seu Nome/Time]
