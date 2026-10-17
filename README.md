# Neon Royale

Battle royale 2D minimalista (silhuetas pretas, cores neon, arena cinza escura) para jogar pelo
navegador na mesma rede Wi-Fi. Versão 0.16.1: **2 a 6 jogadores, 30 personagens, 25 mapas e 9 modos de jogo**.

## Rodar

Requisito: Node.js 22 LTS num computador.

```bash
npm install
npm run build
npm start
```

O terminal mostra o endereço (ex.: `http://192.168.0.12:3100`) e um QR code. Um jogador cria a
sala, o outro entra pelo QR code ou pelo código; o anfitrião aperta ▶.

Desenvolvimento: `npm run dev` (abra pela porta 5173) · testes: `npm test`.

## Lobby, som e espectador

- O anfitrião (coroa) pode **expulsar** jogadores pelo botão ao lado do nome, com confirmação. Quem é expulso volta ao menu com um aviso (e pode entrar de novo pelo código).
- O lobby tem 3 etapas: **Modo → Mapa → Personagem**. O anfitrião escolhe modo e mapa; todos escolhem personagem.
- Sons gerados no navegador, sem arquivos: tiros, golpes, explosões, habilidades, dano, morte, pickups e contagem. O botão de alto-falante, no canto da tela, liga e desliga (fica salvo). No celular, o som começa depois do primeiro toque.
- Morreu num modo sem renascimento: a câmera segue quem te eliminou. Clique, espaço ou o botão de ataque trocam de jogador; o joystick ou WASD soltam a câmera.

## Mini mapa

No canto inferior esquerdo (no celular, logo acima do joystick) aparece o mapa com obstáculos, água e lava, e só a sua posição, com a direção da mira. Ele não atrapalha os toques do joystick.

## Controles

| | Computador | Celular |
|---|---|---|
| Mover | WASD / setas | joystick (metade esquerda) |
| Mirar e atacar | mouse + clique (segurar atira sem parar) ou espaço | botão grande: tocar ataca; segurar ataca sem parar; arrastar mira |
| Habilidade ativa | E ou Q | botão menor |

## Personagens (30)

Todos têm 100 de vida e 190 px/s, salvo as passivas. Entre parênteses, a recarga.

| Personagem | Arma | Ativa | Passiva |
|---|---|---|---|
| Veni | Arco explosivo (1,5 s): 20 no centro, 10 na borda | Teletransporte de fuga (10 s) | Flecha preparada: +50% e explosão maior |
| Gut | Espada de fogo (0,75 s): 15 + queima 3×3 | Giro flamejante (8 s): 14, empurra, queima | +40% de velocidade |
| Vini | Canhão de tinta (0,9 s): 14 + poça (−50% de velocidade, até 5) | Balde (7 s) | Surfista de tinta; a tinta revela invisíveis |
| Daniel | Guarda-chuva (0,6 s): 16, arco estreito | Escudo de 360° por 5 s (10 s) | Ao acabar o escudo, solta 12 agulhas em volta (3 cada) |
| Lucas | Raios (0,6 s): 5 em volta + lentidão | Onda de choque (10 s): 16 e empurra | Estática: 2 de volta em quem o acerta (qualquer ataque) |
| Pacheco | Mangueira (18 gotas/s): 1 cada | Voo de 4 s (7 s) | Anda sobre a água; a lava queima o dobro |
| Sombra | Adagas (0,5 s): 2 × 5 | Invisível por 5 s (10 s); o 1º ataque +50% | +30% pelas costas |
| Vampiro | Seringa (0,9 s): 12, recupera 40% | Totem: cura 5/s por 5 s (7 s) | +10 de vida por eliminação |
| Engenheiro | Pregos (0,9 s): 3 × 4 | Parede sólida por 5 s (6 s) | −20% de dano de projéteis |
| Pescador | Rede (0,8 s): 10 | Gancho que puxa (2 s) | Pega pickups a 150 px |
| Gravidade | Orbe lento (1,2 s): 9, atravessa | Buraco negro por 2 s (8 s) | Imune a empurrões e puxões |
| Ilusionista | Bumerangue (1,1 s): 9 na ida + 9 na volta | 5 clones em direções diferentes por 4 s (6 s) | Invisível 1,5 s abaixo de 25 de vida (1 vez) |
| Atirador | Rifle (1 s): 14, carregado até 35 | Corrida: +50% de velocidade por 3 s (8 s) | Parado 1 s: +25%; leva +25% de golpes corpo a corpo |
| Granadeiro | Granada em arco (1,6 s): 18, passa por cima de paredes | Chuva de 5 granadas (8 s) | Explode ao ser eliminado (20) |
| Armadilheiro | Besta (0,85 s): 11 | Mina: prende 1,5 s e causa 10, até 3 (6 s) | Vê minas e invisíveis a 150 px |
| Gelo | Cristais (0,6 s): 7 + frio | Congela todos em volta por 1,5 s e causa 8 (8 s) | Quem bate nele ganha 2 de frio |
| Veneno | Zarabatana (0,7 s): 3 + veneno 2 × 4 s | Nuvem tóxica: 5/s por 6 s (8 s) | Imune a veneno e queimadura |
| Hacker | Pistola de pulso (0,55 s): 8 | Pane: sem habilidade por 4 s (3 s) | Não aparece nas setas |
| Relojoeiro | Ponteiros (0,8 s): 3 × 5 | Volta 5 s no tempo (9 s) | Eco: onda de 5 de dano onde chega |
| Berserker | Machado (1 s): 18 | Fúria: +40% de ataque e roubo de vida por 4 s (13 s) | Até +50% de dano com pouca vida |
| Domador | Estilingue (0,8 s): 12 | Drone que atira sozinho por 8 s (14 s) | −5 s na recarga por eliminação |
| Espelho | Cacos (0,8 s): 3 × 5 | Reflexo: devolve projéteis por 3 s (8 s) | 35% de chance de deixar um reflexo ao levar dano |
| Ninja | Shuriken (0,55 s): 7, quica 2 vezes | Avanço de 200 px (7 s) | +15% de velocidade |
| Tanque | Canhão (1,4 s): 24, explode | Investida de 160 px: 12 e empurra (11 s) | 140 de vida, 15% mais lento |
| Médico | Dardo (0,7 s): 9 | Kit: cura 30 e limpa efeitos (14 s) | Regenera 2/s após 3 s sem dano |
| Caçador | Boleadeira (1 s): 10 e prende 0,6 s | Marcar (12 s): +25% de dano de todos por 5 s; as boleadeiras viram teleguiadas até o alvo, com metade do dano | +20% em alvos lentos ou presos |
| Laserista | Feixe instantâneo e largo (0,45 s): 6 | Sobrecarga: recarga na metade por 3 s (10 s) | +1 por acerto seguido no mesmo alvo (até +4) |
| Trocador | Bolhas (0,8 s): 10 | Troca de lugar com o inimigo mais próximo, até 700 px (5 s) | O trocado fica 30% mais lento por 1,5 s |
| Bardo | Notas (0,65 s): 8 | Canção: +35% de velocidade e ataque por 4 s (7 s) | O 4º acerto causa o dobro |
| Astro | Estrela cadente (1,3 s): 16 | Meteoro com 1 s de aviso: 30 no centro (12 s) | Eliminar recarrega o meteoro |

## Regras gerais

- Vida 100. Último vivo vence. Contagem de 3 s no começo.
- **Área segura da sua cor:** você não leva dano lá dentro. Atacar de lá desliga a proteção; ela também
  acaba depois de 8 s seguidos. Sair e entrar de novo devolve a proteção.
- **Pickups:** cruz = +35 de vida (volta em 20 s); losango = +50% de dano por 8 s (volta em 30 s).
- **Modos** (o anfitrião escolhe no lobby):
  - **Royale:** o último vivo vence.
  - **10 abates:** quem morre renasce no próprio nascimento depois de 2 s; o primeiro a 10 abates vence.
  - **Corrida armada:** cada abate troca você para o próximo personagem da lista; morrer não troca; vence quem abater com todos os 30.
  - **Mata-mata em equipe:** 2 equipes (até 3 por equipe), sem fogo amigo. A primeira a 25 abates vence. Ao morrer, 3 s para trocar de personagem antes de renascer. O líder (o primeiro da equipe) escolhe a cor.
  - **Pega Bandeira:** 7 pontos de controle simétricos (6 em volta e 1 maior no centro). Ficar sozinho no ponto por 3 s o captura; com outro jogador em cima ele fica disputado. Cada ponto rende 1 por segundo (o do centro, 3). Vence quem chega a 300 ou quem tem mais em 5 minutos. Abates não pontuam. **Só nos mapas feitos para ele (Colmeia e Encruzilhada).** Ao morrer, 3 s para trocar de personagem.
  - **Pega Bandeira em equipe:** igual, com os pontos somados por equipe e sem fogo amigo.
  - **Pintão:** andar pinta o chão com a sua cor e os tiros pintam onde caem (explosões pintam a área toda). Vence quem tiver mais área em 3 minutos. Ao morrer, você perde tudo o que pintou. Abates não pontuam.
  - **Pintão em equipe:** igual, com a cor da equipe e a área somada. Quem morre perde só as casas que ele mesmo pintou.
  - **Neoncalypse:** royale com dano, ataques e habilidades em dobro (recargas pela metade) e movimento +50%. A zona fecha para o centro a cada 30 s, com dano crescente fora dela. Sem áreas seguras e sem renascimento.
- **Mapas** (o anfitrião escolhe no lobby), simétricos nos dois eixos (menos o Desfiladeiro) e com o centro aberto:
  - **Praça:** praça central com pilares, galpões com portas, bosque de pilares e muretas.
  - **Fortaleza:** muralha no centro com quatro portões, corredores longos e quartéis.
  - **Arquipélago:** lagos (bloqueiam a passagem, mas não os tiros), rochas e ilhas.
  - **Labirinto:** anéis de muros em volta do centro, passagens estreitas e becos.
  - **Cidade:** quarteirões em grade, ruas retas, cercas baixas e uma praça no centro.
  - **Rio:** rios cruzando o mapa com pontes estreitas e campos abertos.
  - **Colmeia** (feito para o Pega Bandeira): 7 praças muradas, cada uma com um ponto.
  - **Encruzilhada** (feito para o Pega Bandeira): 3 caminhos largos com 2 pontos cada e o maior no cruzamento do centro.
  - **Ruínas:** muitos obstáculos; linhas de tiro curtas e emboscadas.
  - **Vulcão:** dezenas de poças de lava entre pedras.
  - **Cratera:** lago de lava gigante em volta da ilha do centro, com 4 pontes, e poças grandes nas bordas.
  - **Desfiladeiro (assimétrico):** campo aberto à esquerda, cânion cheio de cobertura à direita, rio com uma ponte embaixo. Nos modos em equipe, os times trocam de lado a cada partida.
  - **Coliseu:** arena pequena e quase vazia, para partidas rápidas.
  - **Fortes:** duas bases muradas, com portões e torres (bom para equipes).
  - **Ilhas de lava:** quase tudo é lava; ilhas ligadas por pontes estreitas.
  - **Selva:** moitas escondem quem está dentro de quem está longe (a mais de 120 px); atacar revela por 1,5 s.
  - **Pântano:** lama deixa 40% mais lento.
  - **Abismo:** buracos sem fundo; cair é morte na hora, e o abate vai para quem acertou nos últimos 3 s.
  - **Portais:** 4 pares de portais ligam lados opostos do mapa (1 s de espera entre usos).
  - **Trampolins:** pisar lança o jogador por cima dos muros até o outro lado.
  - **Pista de gelo:** o gelo escorrega; o personagem demora para acelerar e frear.
  - **Fábrica:** esteiras arrastam quem está em cima; prensas fecham de 6 em 6 s.
  - **Apagão:** escuro; cada um só vê os outros a até 300 px ou perto dos postes de luz.
  - **Labirinto vivo:** paredes que abrem e fecham a cada 10 s, trocando os caminhos.
  - **Demolição:** muros que quebram com tiros e explosões (60 de vida cada).
- **Lava:** dá para andar, mas queima 8 por segundo (o Pacheco voando passa ileso). Quem morre na lava dá o abate para quem o acertou nos últimos 3 s; empurrões viram armas.
- **Supernova:** a cada 30 s aparece uma num lugar sorteado (uma por vez), com som e uma seta branca na borda da tela. Quem pega ganha um 3º botão (tecla **R**): 5 s com dano em dobro, recargas pela metade e +50% de velocidade; depois o botão some. Morreu segurando, perdeu. No Neoncalypse ela dá +50% de dano e −25% de recarga, para não virar 4×.
- **Obstáculos e muretas** param movimento, flechas, golpes e explosões; a **água** só para o movimento.
- Uma seta na borda da tela aponta para o inimigo quando ele está fora de vista.

Todos os números ficam em `shared/src/config.ts` e `shared/src/personagens.ts`.

## Estrutura

- `shared/` — regras puras usadas no servidor e no cliente: arena, colisão, movimento, personagens, protocolo.
- `server/` — salas, simulação a 20 Hz (`jogo.ts`), Socket.IO.
- `client/` — menus em DOM, arena em Phaser (`scenes/Arena.ts`), controles.
- `tests/` — Vitest.
