# ShareRoom

> Compartilhamento privado de tela e áudio em tempo real.

O **ShareRoom** é um aplicativo desktop para Windows desenvolvido para compartilhar uma tela ou uma janela com outras pessoas de forma simples, rápida e privada.

A transmissão é iniciada pelo aplicativo desktop e os espectadores acessam diretamente pelo navegador através de um **link temporário exclusivo para cada transmissão**.

---

## ✨ Recursos

- Compartilhamento de tela inteira
- Compartilhamento de janelas individuais
- Áudio do sistema
- Áudio exclusivo da janela compartilhada
- Viewer diretamente pelo navegador
- Links privados e temporários por transmissão
- Limite configurável de espectadores
- Troca de tela sem encerrar a transmissão
- Resoluções 720p e 1080p
- 30 FPS e 60 FPS
- Interface própria para Desktop e Viewer
- Transmissão em tempo real utilizando WebRTC

---

## 🖥️ Como funciona

O fluxo do ShareRoom foi pensado para ser simples:

**1.** Abra o ShareRoom no Windows  
**2.** Escolha uma tela ou janela  
**3.** Configure a qualidade da transmissão  
**4.** Confira a prévia  
**5.** Inicie a transmissão  
**6.** Copie o link gerado  
**7.** Envie o link para quem deseja assistir  
**8.** O espectador acessa diretamente pelo navegador

Quem recebe o link **não precisa instalar nenhum aplicativo**.

---

## 📸 Interface

### Início

![ShareRoom Home](assets/home.png)

### Escolha da tela ou janela

![Seleção de tela do ShareRoom](assets/sources.png)

### Transmissão ao vivo

![ShareRoom durante uma transmissão](assets/live.png)

### Viewer

![Viewer web do ShareRoom](assets/viewer.png)

---

## 🔒 Privacidade

Cada transmissão do ShareRoom possui uma sessão própria e um novo acesso privado.

O link compartilhado pertence àquela transmissão específica e não concede acesso automático às transmissões futuras.

Também é possível definir previamente o número máximo de espectadores permitidos na sessão.

Quando a transmissão é encerrada, o Viewer informa ao espectador que o compartilhamento foi finalizado.

---

## 🛠️ Tecnologias

O ShareRoom foi desenvolvido utilizando:

- **Electron**
- **React**
- **TypeScript**
- **Vite**
- **Node.js**
- **Express**
- **LiveKit**
- **WebRTC**
- **PostgreSQL / Neon**
- **Vercel**
- **Windows WASAPI**

Para captura de áudio no Windows, o ShareRoom utiliza um componente nativo responsável pelo áudio do sistema e pelo áudio exclusivo de aplicações.

---

## 📦 Download

### ShareRoom 1.0.0

A versão mais recente está disponível na seção **Releases** deste repositório.

**[Baixar a versão mais recente](https://github.com/guimendesfe/ShareRoom-App/releases/latest)**

### Compatibilidade

**Windows 10 / Windows 11 — 64 bits**

> **Observação:** o ShareRoom ainda não possui assinatura digital de código.  
> Por isso, o Windows SmartScreen pode apresentar um aviso ao executar o instalador pela primeira vez.

---

## 🚀 Versão 1.0.0

A versão **1.0.0** representa a primeira versão pública do ShareRoom e contempla o fluxo principal da aplicação:

**Seleção da fonte → Configuração → Prévia → Transmissão → Viewer → Troca de tela → Encerramento**

---

## 🧩 Arquitetura

O ShareRoom é dividido em três partes principais:

**Desktop**  
Aplicação Electron responsável por seleção de tela ou janela, captura de áudio, controle da transmissão e geração dos convites.

**Backend**  
Responsável pelo gerenciamento das sessões, autenticação dos convites e controle de acesso dos espectadores.

**Viewer Web**  
Interface acessada pelo navegador para assistir à transmissão em tempo real sem necessidade de instalação.

---

## 📌 Sobre o projeto

O ShareRoom nasceu como um projeto independente com o objetivo de explorar desenvolvimento desktop, transmissão em tempo real, WebRTC, integração com serviços em nuvem e captura nativa de áudio no Windows.

O código-fonte principal é mantido em um repositório privado.

Este repositório público é destinado à **apresentação do projeto, documentação e distribuição das versões oficiais do ShareRoom**.

---

## 👨‍💻 Desenvolvido por

**Guilherme Mendes**

Projeto desenvolvido como produto e projeto independente.

---

## ShareRoom

**Simple. Private. Real-time.**
