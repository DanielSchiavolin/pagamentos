# Front Security — Pagamentos

App: https://danielschiavolin.github.io/pagamentos/

Fechamento mensal de pagamentos por posto (QTH). Dados em `/pagamentos` do mesmo Firebase do app Coberturas
(o Coberturas é só lido: postos de segurança no primeiro acesso e nomes dos QRAs para sugestão).

## Como usar
- Escolha o mês no topo (‹ › ou "Mês atual").
- Toque no posto → aparece o mês, dia a dia, com os turnos do posto. Em cada turno, "+ lançar":
  - **QRA** que trabalhou (sugestões da lista do Coberturas),
  - **Valor do turno** (vem o padrão do posto — defina em "✏️ Editar posto"),
  - **Hora extra (R$)** soma, **Atraso / desconto (R$)** subtrai,
  - **Dobra**: marcada sozinha se o mesmo QRA trabalhou o turno colado (antes/depois); aí aparece o **3/6** (extra pela dobra).
  - "＋" no fim do dia: lançamento extra (ex.: dois QRAs no mesmo turno ou turno fora da escala).
- **Limpeza** (Bosque, Marechal, Ibirapuera, Campo Belo): salário fixo — cadastre os funcionários em "✏️ Editar posto"
  (uma linha por pessoa: `Nome ; salário`) — e lance as **coberturas** do mês.

## Exportar para o WhatsApp
- **Por posto**: botão "📱 Exportar" no card ou "📱 Exportar este posto" na tela do mês.
  Traz dias do posto, turnos, valor, hora extra, descontos, 3/6, total e cada QRA (dias, turnos e valores).
- **Geral**: botão verde 📱 no canto → todos os postos juntos + total geral + total por QRA.
- Sempre do mês que estiver selecionado no topo (atual ou anterior).

## Publicar uma versão nova
Aumente `APP_VERSION` (app.js) e `version.json` com o mesmo valor; os apps abertos se atualizam sozinhos.
