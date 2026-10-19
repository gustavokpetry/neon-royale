<div align="center">

# ⚡ Neon Royale

**Battle royale 2D minimalista para jogar no navegador, na mesma rede Wi-Fi.**

Silhuetas pretas, cores neon, arena escura. Abre no PC, escaneia o QR code no celular e joga.

![Versão](https://img.shields.io/badge/vers%C3%A3o-0.16.1-ff00ff?style=for-the-badge)
![Jogadores](https://img.shields.io/badge/jogadores-2%20a%206-00ffff?style=for-the-badge)
![Personagens](https://img.shields.io/badge/personagens-30-39ff14?style=for-the-badge)
![Mapas](https://img.shields.io/badge/mapas-25-ffea00?style=for-the-badge)
![Modos](https://img.shields.io/badge/modos-9-ff6600?style=for-the-badge)

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Phaser](https://img.shields.io/badge/Phaser_3-8B5CF6?style=flat-square)
![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?style=flat-square&logo=socket.io&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=flat-square&logo=vitest&logoColor=white)

<!-- Coloque um GIF da partida aqui: ![Gameplay](docs/gameplay.gif) -->

</div>

---

## 🚀 Como jogar

Precisa de **Node.js 20+** em um computador da rede.

```bash
npm install
npm run build
npm start
```

O terminal mostra o endereço (ex.: `http://192.168.0.12:3100`) e um **QR code**.
Um jogador cria a sala, os outros entram pelo QR code ou pelo código, e o anfitrião aperta ▶.

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor + cliente com hot reload (porta 5173) |
| `npm test` | Roda os testes (Vitest) |
| `npm run typecheck` | Checa os tipos |

## 🎮 Controles

| | 🖥️  Computador | 📱 Celular |
|---|---|---|
| **Mover** | WASD / setas | Joystick (metade esquerda) |
| **Mirar e atacar** | Mouse + clique (segurar atira sem parar) ou espaço | Botão grande: toque ataca, segurar repete, arrastar mira |
| **Habilidade** | E ou Q | Botão menor |
| **Supernova** | R | 3º botão (aparece ao pegar) |

## ✨ Destaques

- **Lobby em 3 etapas:** Modo → Mapa → Personagem. O anfitrião escolhe modo e mapa, cada um escolhe seu personagem. O anfitrião pode expulsar jogadores.
- **Som 100% gerado no navegador**, sem arquivos de áudio. Botão de alto-falante liga e desliga.
- **Modo espectador:** morreu? A câmera segue quem te eliminou. Clique para trocar de jogador.
- **Mini mapa** com obstáculos, água, lava e sua posição.
- **Supernova:** a cada 30 s surge uma no mapa. Quem pega ganha 5 s de dano em dobro, recarga pela metade e +50% de velocidade.
- **Área segura da sua cor:** sem dano lá dentro. Atacar de lá ou ficar 8 s seguidos desliga a proteção.
- **Pickups:** cruz = +35 de vida · losango = +50% de dano por 8 s.

## 🏆 Modos de jogo

| Modo | Como vencer |
|---|---|
| **Royale** | Último vivo vence |
| **10 abates** | Primeiro a 10 abates. Renasce em 2 s |
| **Corrida armada** | Cada abate troca seu personagem. Vence quem abater com todos os 30 |
| **Mata-mata em equipe** | 2 equipes, primeira a 25 abates. Sem fogo amigo |
| **Pega Bandeira** | 7 pontos de controle. Ponto rende 1/s (centro 3/s). Vence com 300 ou mais pontos em 5 min. Só nos mapas Colmeia e Encruzilhada |
| **Pega Bandeira em equipe** | Igual, com pontos somados por equipe |
| **Pintão** | Andar pinta o chão. Vence quem pintou mais |
| **Pintão em equipe** | Igual, com a cor da equipe |
| **Neoncalypse** | Royale com tudo em dobro, movimento +50% e zona que fecha a cada 30 s. Sem área segura |

## 🗺️  Mapas

Todos simétricos nos dois eixos (menos o Desfiladeiro) e com o centro aberto.

<details>
<summary><b>Ver os 25 mapas</b></summary>

<br>

| Mapa | Característica |
|---|---|
| **Praça** | Pilares, galpões com portas e muretas |
| **Fortaleza** | Muralha central com 4 portões e corredores longos |
| **Arquipélago** | Lagos bloqueiam passagem, mas não tiros |
| **Labirinto** | Anéis de muros, passagens estreitas e becos |
| **Cidade** | Quarteirões em grade e ruas retas |
| **Rio** | Rios com pontes estreitas e campos abertos |
| **Colmeia** 🚩 | 7 praças muradas, cada uma com um ponto (Pega Bandeira) |
| **Encruzilhada** 🚩 | 3 caminhos largos, ponto maior no centro (Pega Bandeira) |
| **Ruínas** | Muitos obstáculos, linhas de tiro curtas |
| **Vulcão** | Dezenas de poças de lava |
| **Cratera** | Lago de lava gigante em volta da ilha central, 4 pontes |
| **Desfiladeiro** | Assimétrico: campo aberto de um lado, cânion do outro. Equipes trocam de lado |
| **Coliseu** | Arena pequena e vazia, partidas rápidas |
| **Fortes** | Duas bases muradas com portões e torres |
| **Ilhas de lava** | Quase tudo é lava, ilhas ligadas por pontes |
| **Selva** | Moitas escondem quem está longe; atacar revela por 1,5 s |
| **Pântano** | Lama deixa 40% mais lento |
| **Abismo** | Buracos sem fundo: cair é morte na hora |
| **Portais** | 4 pares de portais ligando lados opostos |
| **Trampolins** | Lançam o jogador por cima dos muros |
| **Pista de gelo** | O chão escorrega |
| **Fábrica** | Esteiras arrastam, prensas fecham a cada 6 s |
| **Apagão** | Escuro: só vê quem está perto ou sob os postes |
| **Labirinto vivo** | Paredes abrem e fecham a cada 10 s |
| **Demolição** | Muros destrutíveis (60 de vida cada) |

**Terrenos:** lava queima 8/s · água bloqueia movimento mas não tiros · obstáculos param tudo.

</details>

## 🦸 Personagens

30 personagens, cada um com **arma**, **habilidade ativa** e **passiva**. Todos têm 100 de vida e 190 px/s, salvo as passivas.

<details>
<summary><b>Ver os 30 personagens</b></summary>

<br>

Entre parênteses, a recarga.

| Personagem | Arma | Ativa | Passiva |
|---|---|---|---|
| **Veni** | Arco explosivo (1,5 s): 20 no centro, 10 na borda | Teletransporte de fuga (10 s) | Flecha preparada: +50% e explosão maior |
| **Gut** | Espada de fogo (0,75 s): 15 + queima 3×3 | Giro flamejante (8 s): 14, empurra, queima | +40% de velocidade |
| **Vini** | Canhão de tinta (0,9 s): 14 + poça (−50% de velocidade) | Balde (7 s) | Surfa na tinta; a tinta revela invisíveis |
| **Daniel** | Guarda-chuva (0,6 s): 16, arco estreito | Escudo 360° por 5 s (10 s) | Ao acabar o escudo, solta 12 agulhas (3 cada) |
| **Lucas** | Raios (0,6 s): 5 em volta + lentidão | Onda de choque (10 s): 16 e empurra | Estática: 2 de volta em quem o acerta |
| **Pacheco** | Mangueira (18 gotas/s): 1 cada | Voo de 4 s (7 s) | Anda sobre a água; lava queima o dobro |
| **Sombra** | Adagas (0,5 s): 2 × 5 | Invisível por 5 s (10 s); 1º ataque +50% | +30% pelas costas |
| **Vampiro** | Seringa (0,9 s): 12, recupera 40% | Totem: cura 5/s por 5 s (7 s) | +10 de vida por eliminação |
| **Engenheiro** | Pregos (0,9 s): 3 × 4 | Parede sólida por 5 s (6 s) | −20% de dano de projéteis |
| **Pescador** | Rede (0,8 s): 10 | Gancho que puxa (2 s) | Pega pickups a 150 px |
| **Gravidade** | Orbe lento (1,2 s): 9, atravessa | Buraco negro por 2 s (8 s) | Imune a empurrões e puxões |
| **Ilusionista** | Bumerangue (1,1 s): 9 na ida + 9 na volta | 5 clones por 4 s (6 s) | Invisível 1,5 s abaixo de 25 de vida (1 vez) |
| **Atirador** | Rifle (1 s): 14, carregado até 35 | Corrida: +50% de velocidade por 3 s (8 s) | Parado 1 s: +25%; leva +25% de corpo a corpo |
| **Granadeiro** | Granada em arco (1,6 s): 18, passa por paredes | Chuva de 5 granadas (8 s) | Explode ao ser eliminado (20) |
| **Armadilheiro** | Besta (0,85 s): 11 | Mina: prende 1,5 s e causa 10, até 3 (6 s) | Vê minas e invisíveis a 150 px |
| **Gelo** | Cristais (0,6 s): 7 + frio | Congela todos em volta por 1,5 s, causa 8 (8 s) | Quem bate nele ganha 2 de frio |
| **Veneno** | Zarabatana (0,7 s): 3 + veneno 2 × 4 s | Nuvem tóxica: 5/s por 6 s (8 s) | Imune a veneno e queimadura |
| **Hacker** | Pistola de pulso (0,55 s): 8 | Pane: alvo sem habilidade por 4 s (3 s) | Não aparece nas setas |
| **Relojoeiro** | Ponteiros (0,8 s): 3 × 5 | Volta 5 s no tempo (9 s) | Eco: onda de 5 de dano onde chega |
| **Berserker** | Machado (1 s): 18 | Fúria: +40% de ataque e roubo de vida por 4 s (13 s) | Até +50% de dano com pouca vida |
| **Domador** | Estilingue (0,8 s): 12 | Drone que atira sozinho por 8 s (14 s) | −5 s de recarga por eliminação |
| **Espelho** | Cacos (0,8 s): 3 × 5 | Reflexo: devolve projéteis por 3 s (8 s) | 35% de chance de deixar um reflexo ao levar dano |
| **Ninja** | Shuriken (0,55 s): 7, quica 2 vezes | Avanço de 200 px (7 s) | +15% de velocidade |
| **Tanque** | Canhão (1,4 s): 24, explode | Investida de 160 px: 12 e empurra (11 s) | 140 de vida, 15% mais lento |
| **Médico** | Dardo (0,7 s): 9 | Kit: cura 30 e limpa efeitos (14 s) | Regenera 2/s após 3 s sem dano |
| **Caçador** | Boleadeira (1 s): 10, prende 0,6 s | Marcar (12 s): alvo leva +25% de todos por 5 s; boleadeiras viram teleguiadas | +20% em alvos lentos ou presos |
| **Laserista** | Feixe instantâneo (0,45 s): 6 | Sobrecarga: recarga na metade por 3 s (10 s) | +1 por acerto seguido no mesmo alvo (até +4) |
| **Trocador** | Bolhas (0,8 s): 10 | Troca de lugar com o inimigo mais próximo (5 s) | O trocado fica 30% mais lento por 1,5 s |
| **Bardo** | Notas (0,65 s): 8 | Canção: +35% de velocidade e ataque por 4 s (7 s) | O 4º acerto causa o dobro |
| **Astro** | Estrela cadente (1,3 s): 16 | Meteoro com 1 s de aviso: 30 no centro (12 s) | Eliminar recarrega o meteoro |

</details>

Todos os números ficam em `shared/src/config.ts` e `shared/src/personagens.ts`.

## 🧱 Estrutura

```
shared/   regras puras usadas no servidor e no cliente (arena, colisão, personagens, protocolo)
server/   salas, simulação a 20 Hz e Socket.IO
client/   menus em DOM, arena em Phaser, controles
tests/    testes com Vitest
```
