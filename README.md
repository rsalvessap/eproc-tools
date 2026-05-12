# eProc Toolkit

Userscript unificado com ferramentas de automação para o eProc TJSP. Instale uma vez e ative ou desative cada módulo individualmente direto na tela do sistema.

---

## Módulos disponíveis

| Módulo | Descrição |
|---|---|
| **Remigrar Processo** | Automação em lote da remigração por módulo (CAS, ZIP, Vídeos) |
| **Corrigir Inconsistências** | Remoção em lote de duplicatas na tela de inconsistências |

---

## Pré-requisitos

### 1. Instalar o Tampermonkey

Abra a loja de extensões do seu navegador (Chrome, Edge ou Firefox), procure por **Tampermonkey** e instale a extensão. Após instalar, confirme que o ícone do Tampermonkey apareceu próximo à barra de endereço.

### 2. Ativar o modo desenvolvedor no navegador

Isso é necessário para o Tampermonkey rodar o script sem bloqueio.

- Vá em **Configurações → Extensões**
- No canto superior direito, ative **Modo do desenvolvedor**

### 3. Configurações do Tampermonkey

- Clique no ícone do Tampermonkey → **Painel** → **Configurações**
- Confirme que estas opções estão ativas:
  - Permitir scripts de usuário
  - Permitir acesso a abas
  - Permitir requisições remotas
  - Modo estrito desativado *(se existir no seu navegador)*

---

## Instalação

> **Redes corporativas (ex: TJSP):** o link de instalação direta pode ser bloqueado pelo proxy da rede. Use o método manual abaixo.

### Método 1 — Instalação direta *(fora da rede corporativa)*

👉 [Clique aqui para instalar o script](https://raw.githubusercontent.com/rsalvessap/eproc-tools/main/eproc-toolkit.user.js)

O Tampermonkey abrirá automaticamente a tela de confirmação — clique em **Instalar**.

### Método 2 — Instalação manual *(recomendado na rede do TJSP)*

1. Acesse a página do script no GitHub: [eproc-toolkit.user.js](https://github.com/rsalvessap/eproc-tools/blob/main/eproc-toolkit.user.js)
2. Clique no botão **Raw** (canto superior direito do arquivo)
3. Selecione todo o conteúdo da página (`Ctrl + A`) e copie (`Ctrl + C`)
4. Clique no ícone do Tampermonkey → **Criar novo script**
5. Apague o conteúdo padrão, cole o código copiado (`Ctrl + V`)
6. Salve com `Ctrl + S`

---

## Como usar

Após instalar, acesse qualquer página do eProc:
`https://eproc1g.tjsp.jus.br/eproc/controlador.php`

Um botão **🔧** aparecerá no canto inferior esquerdo da tela. Clique nele para abrir o painel do Toolkit.

### Painel de controle

O painel mostra todos os módulos disponíveis com um toggle para ativar ou desativar cada um. O status indica se o módulo está ativo **nesta página** (ou seja, se a URL atual corresponde ao módulo).

As configurações são salvas automaticamente — você não precisa reativar os módulos a cada acesso.

### Módulo: Remigrar Processo

Ative o módulo e acesse a página de remigração:
`https://eproc1g.tjsp.jus.br/eproc/controlador.php?acao=remigrar_processo`

A HUD aparecerá no canto inferior direito. Faça upload de um arquivo `.txt` ou `.csv` com os números de processo (um por linha) e clique em **Iniciar**.

**Processamento paralelo:** Para listas grandes, abra a mesma página em várias abas, configure cada aba com uma instância diferente (Instância 1 de N, Instância 2 de N…) e inicie em cada aba.

**Resultados:** Exportados em CSV, automaticamente a cada 100 processos e ao finalizar.

### Módulo: Corrigir Inconsistências

Ative o módulo e acesse a página de inconsistências:
`https://eproc1g.tjsp.jus.br/eproc/controlador.php?acao=ProcessoInconsistente/consultar`

A HUD aparecerá no canto inferior direito. Cole os números de processo na área de texto (um por linha) e clique em **Iniciar**.

**Lógica de remoção:** O script prioriza remover entradas com valor "Requerida", depois entradas de usuários (mantendo as do SISTEMA), e como último recurso remove a primeira entrada com botão disponível.

**Resultados:** Exportados em `.txt` com status por processo (✅ Corrigido / ℹ️ Sem duplicatas / ❌ Erro).

---

## Recuperação automática

Ambos os módulos salvam o estado da fila antes de cada operação. Se o navegador fechar ou a aba recarregar, o processamento é retomado automaticamente do ponto onde parou ao retornar à página.

---

## Controles dos módulos

### Remigrar Processo

| Botão | Ação |
|---|---|
| Iniciar | Inicia o processamento |
| Pausar | Pausa e salva o estado atual |
| Retomar | Continua de onde parou |
| Parar | Encerra e exporta os resultados |
| Exportar agora | Exporta CSV parcial sem interromper |

### Corrigir Inconsistências

| Botão | Ação |
|---|---|
| Iniciar | Inicia o processamento em lote |
| Parar | Interrompe o processamento |
| Exportar Log | Baixa o relatório em `.txt` |
| Limpar | Remove os registros do log local |
