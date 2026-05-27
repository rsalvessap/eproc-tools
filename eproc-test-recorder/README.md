# eProc — Gravador de Testes para Homologação

Userscript para **registrar ações no eProc** durante testes de homologação de novas funcionalidades. Gera um relatório HTML completo com todos os passos executados e prints de tela embutidos.

---

## Instalação

1. Instale a extensão [Tampermonkey](https://www.tampermonkey.net/) no Chrome/Edge/Firefox
2. Clique em **"Instalar novo script"** no Tampermonkey
3. Cole o conteúdo de `eproc-test-recorder.user.js` ou arraste o arquivo para a extensão

> **Requisito:** O Tampermonkey precisa de permissão para acessar `cdnjs.cloudflare.com` (onde a biblioteca de captura de tela é carregada). Se o ambiente bloquear esse CDN, os prints continuam funcionando — mas apenas com descrição textual, sem captura automática da tela.

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
Clique em **📷 Print** para capturar a tela atual:
- O painel some temporariamente durante a captura
- Uma miniatura aparece no modal para confirmação
- Adicione uma descrição do que está visível e clique em **Salvar**
- O print fica embutido no relatório final

### 4. Adicionar anotações
Clique em **✏️ Nota** para registrar observações manuais (anomalias, comportamentos esperados/inesperados, etc.).

### 5. Parar e exportar
- Clique em **⏹ Parar Gravação** ao finalizar o teste
- Clique em **⬇ Exportar Relatório** para baixar o arquivo HTML
- O relatório pode ser aberto no navegador ou impresso (`Ctrl+P`)

---

## Painel de controle

```
┌─────────────────────────┐
│ ● GRAVANDO    12 passos │  ← cabeçalho (arraste para mover)
├─────────────────────────┤
│ Registrando ações...    │
│ [ ⏹ Parar Gravação   ] │
│ [ 📷 Print ] [ ✏️ Nota ] │
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

O arquivo gerado contém uma tabela com todos os passos:

| # | Tipo | Horário | Descrição / Print | Página |
|---|---|---|---|---|
| 1 | INÍCIO | 10:30:00 | Gravação iniciada — Consulta Processual | ... |
| 2 | BOTÃO | 10:30:05 | Botão clicado: "Pesquisar" | ... |
| 3 | INPUT | 10:30:04 | Campo "Número do Processo": "1234567..." | ... |
| 4 | PRINT | 10:30:10 | Resultado da pesquisa exibido *(+ imagem)* | ... |

**Tipos de passo:** `INÍCIO` `BOTÃO` `LINK` `MENU` `SELEÇÃO` `INPUT` `ENVIO` `POPUP` `PRINT` `NOTA` `NAVEGAÇÃO`

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
- Se o site bloquear o CDN do `html2canvas`, o botão de print ainda funciona mas sem captura automática da tela
- Campos do tipo `password` são registrados como `(senha)` por segurança

---

## Versão

**4.0.0** — Captura real de tela via html2canvas, registro expandido de cliques (incluindo elementos com `onclick`), captura de campos de texto no `blur`, prints embutidos no relatório HTML.
