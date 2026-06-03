# eProc — Gravador de Testes para Homologação

Userscript para **registrar ações no eProc** durante testes de homologação de novas funcionalidades. Gera um relatório HTML completo com todos os passos executados e prints de tela embutidos.

**Versão atual:** 4.3.0

---

## Instalação

1. Instale a extensão [Tampermonkey](https://www.tampermonkey.net/) no Chrome, Edge ou Firefox
2. Clique no link abaixo para instalar diretamente:

👉 [Instalar script](https://raw.githubusercontent.com/rsalvessap/eproc-tools/main/eproc-test-recorder.user.js)

> O Tampermonkey detecta o arquivo `.user.js` automaticamente e abre a tela de instalação.

> **Redes corporativas:** se o link acima for bloqueado, acesse o arquivo no GitHub, clique em **Raw**, copie o conteúdo e cole em um novo script no Tampermonkey manualmente.

---

## Como usar

### 1. Iniciar gravação

Clique em **▶ Iniciar Gravação** no painel fixo no canto inferior direito da tela.

### 2. Execute o teste normalmente

A partir desse momento, as seguintes ações são registradas **automaticamente**:

| Ação | O que é registrado |
|---|---|
| Clique em botão | Nome/texto do botão |
| Clique em link | Texto do link + ação eProc extraída da URL |
| Clique em elemento com `onclick` | Texto do elemento (cobre divs, tds e imgs do eProc) |
| Campo de texto preenchido | Nome do campo + valor digitado |
| Seleção em `<select>` | Nome do campo + opção escolhida |
| Checkbox / Radio | Nome da opção + estado (marcado/desmarcado) |
| Formulário enviado | Identificador do formulário |
| Popup / Modal aberto | Título do popup detectado via DOM |
| Navegação entre páginas | Título da nova página |

### 3. Registrar prints

- Clique em **📷 Print** ou use o atalho **`Alt+P`**
- O painel some temporariamente durante a captura
- Uma miniatura aparece no modal para confirmação
- Adicione uma descrição e clique em **Salvar**
- O print fica embutido no relatório final

### 4. Adicionar anotações

- Clique em **✏️ Nota** ou use o atalho **`Alt+A`**
- Registre observações manuais: anomalias, comportamentos esperados/inesperados, etc.

### 5. Parar e exportar

- Clique em **⏹ Parar** ao finalizar o teste
- Clique em **⬇ Exportar Relatório** para baixar o arquivo HTML
- O relatório pode ser aberto no navegador ou impresso (`Ctrl+P`)

---

## Atalhos de teclado

Disponíveis apenas durante a gravação:

| Atalho | Ação |
|---|---|
| `Alt+P` | Capturar print da tela atual |
| `Alt+A` | Abrir modal de anotação |

---

## Painel de controle

```
┌─────────────────────────┐
│ ● GRAVANDO    12 passos │  ← cabeçalho (arraste para mover)
├─────────────────────────┤
│ Registrando ações…      │
│ [ ⏹ Parar             ] │
│ [ 📷 Alt+P ] [ ✏️ Alt+A ] │
│                         │
│ ▾ log                   │
│  [10:32] #12 Botão...   │
└─────────────────────────┘
```

- Clique em **▼** para minimizar (um indicador `● REC` permanece visível)
- O painel pode ser arrastado pela barra do cabeçalho
- O log interno mostra os últimos 50 passos em tempo real

---

## Relatório HTML exportado

O arquivo gerado contém todos os passos registrados com descrição humanizada e prints embutidos.

**Tipos de passo registrados:** `INÍCIO` `BOTÃO` `LINK` `MENU` `SELEÇÃO` `INPUT` `ENVIO` `POPUP` `PRINT` `NOTA` `NAVEGAÇÃO`

---

## Compatibilidade

| Ambiente | Suporte |
|---|---|
| `eproc*.tjsp.jus.br` | ✅ |
| `*-1g-*.tjsp.jus.br` | ✅ |
| `*-2g-*.tjsp.jus.br` | ✅ |
| `sso-*.tjsc.jus.br` | ✅ |

---

## Limitações conhecidas

- **Prints não persistem entre navegações** — as imagens ficam em memória. Se a página recarregar completamente antes de exportar, os prints anteriores são perdidos (os passos de texto são mantidos via `sessionStorage`)
- Campos do tipo `password` são registrados como `(senha)` por segurança
