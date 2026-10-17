/**
 * Personagens jogáveis. Os números foram equilibrados em torno de:
 * - dano por segundo da arma entre ≈ 8 e 27 (quanto mais fácil de acertar, menor);
 * - habilidades ativas com recarga de 9 a 16 s;
 * - 100 de vida e 190 px/s para todos (exceções nas passivas).
 */
export type IdPersonagem =
  | 'veni' | 'gut' | 'vini' | 'daniel' | 'lucas' | 'pacheco'
  | 'sombra' | 'vampiro' | 'engenheiro' | 'pescador' | 'gravidade' | 'ilusionista'
  | 'atirador' | 'granadeiro' | 'armadilheiro' | 'gelo' | 'veneno' | 'hacker'
  | 'relojoeiro' | 'berserker' | 'domador' | 'espelho'
  | 'ninja' | 'tanque' | 'medico' | 'cacador' | 'laserista' | 'trocador' | 'bardo' | 'astro';

/** Desenho do projétil no cliente. */
export type EstiloProjetil = 'flecha' | 'tinta' | 'gota' | 'adaga' | 'dardo' | 'prego' | 'orbe' | 'bumerangue' | 'bala' | 'granada' | 'cristal' | 'pulso' | 'caco' | 'pedra' | 'gancho' | 'shuriken' | 'nota' | 'bolha' | 'estrela' | 'bola' | 'boleadeira';

/** Símbolo dentro da silhueta (ajuda a distinguir cores parecidas). */
export type Marca = 'nada' | 'ponto' | 'anel' | 'triangulo' | 'quadrado' | 'losango' | 'cruz' | 'xis' | 'barra';

export interface Arma {
  nome: string;
  /** aura = golpe em volta do personagem, sem mira. */
  tipo: 'projetil' | 'corpo' | 'aura';
  dano: number;
  recarga: number;
  /** Projétil: alcance em px; corpo a corpo e aura: raio do golpe. */
  alcance: number;
  /** Corpo a corpo: meia abertura do arco, em graus. */
  arcoGraus?: number;
  velocidadeProjetil?: number;
  estilo?: EstiloProjetil;
  /** Vários projéteis por disparo, abertos em leque (graus entre eles). */
  projeteis?: number;
  leque?: number;
  /** Atravessa inimigos (acerta cada um uma vez). */
  atravessa?: boolean;
  /** Vai até o alcance e volta para o dono (acerta na ida e na volta). */
  bumerangue?: boolean;
  /** Voa em arco por cima de obstáculos e explode onde cai. */
  arco?: boolean;
  /** Segurar carrega o tiro (até `carga.bonus` a mais de dano em `carga.seg`). */
  carga?: { seg: number; bonus: number; bonusAlcance: number };
  /** Projétil explosivo: raio e dano mínimo na borda. */
  explosao?: { raio: number; danoBorda: number };
  /** Queimadura / veneno aplicados no acerto: dano por tique (1 s) e número de tiques. */
  queimadura?: { dano: number; tiques: number };
  veneno?: { dano: number; tiques: number };
  /** Tinta: onde o tiro cai fica uma poça que deixa inimigos lentos. */
  tinta?: boolean;
  /** Água (mangueira): só o acerto direto. */
  agua?: boolean;
  /** Fração do dano recuperada como vida. */
  rouboVida?: number;
  /** Cada acerto acumula uma camada de frio (lentidão). */
  frio?: boolean;
  /** Quicadas nas paredes antes de sumir. */
  ricochete?: number;
  /** Tiro instantâneo em linha reta (feixe), sem projétil. */
  instantaneo?: boolean;
  /** Prende o alvo por estes segundos. */
  prende?: number;
}

export interface Personagem {
  id: IdPersonagem;
  nome: string;
  cor: string;
  marca: Marca;
  arma: Arma;
  ativa: { nome: string; descricao: string; recarga: number };
  passiva: { nome: string; descricao: string };
  /** Multiplicador de velocidade (passivas de movimento). */
  velocidade: number;
  /** Vida máxima (padrão 100). */
  vida?: number;
}

const P = (p: Personagem) => p;

export const PERSONAGENS: Record<IdPersonagem, Personagem> = {
  // ------------------------------------------------------------ os 6 originais
  veni: P({
    id: 'veni', nome: 'Veni', cor: '#ff2e4d', marca: 'nada', velocidade: 1,
    arma: { nome: 'Arco explosivo', tipo: 'projetil', dano: 20, recarga: 1.5, alcance: 440, velocidadeProjetil: 560, estilo: 'flecha', explosao: { raio: 58, danoBorda: 10 } },
    ativa: { nome: 'Teletransporte', descricao: 'Salta para o ponto mais longe dos inimigos mais próximos (atravessa obstáculos).', recarga: 10 },
    passiva: { nome: 'Flecha preparada', descricao: 'A primeira flecha depois de teletransportar causa +50% de dano e explode maior.' },
  }),
  gut: P({
    id: 'gut', nome: 'Gut', cor: '#ffd21f', marca: 'nada', velocidade: 1.4,
    arma: { nome: 'Espada de fogo', tipo: 'corpo', dano: 15, recarga: 0.75, alcance: 58, arcoGraus: 60, queimadura: { dano: 3, tiques: 3 } },
    ativa: { nome: 'Giro flamejante', descricao: 'Golpe em 360° que empurra e deixa queimando por 3 s.', recarga: 8 },
    passiva: { nome: 'Velocidade alta', descricao: 'Anda 40% mais rápido.' },
  }),
  vini: P({
    id: 'vini', nome: 'Vini', cor: '#f2f6ff', marca: 'nada', velocidade: 1,
    arma: { nome: 'Canhão de tinta', tipo: 'projetil', dano: 14, recarga: 0.9, alcance: 380, velocidadeProjetil: 420, estilo: 'tinta', tinta: true },
    ativa: { nome: 'Balde', descricao: 'Espalha uma poça grande em volta e empurra quem estiver perto.', recarga: 7 },
    passiva: { nome: 'Surfista de tinta', descricao: 'Anda 30% mais rápido sobre a própria tinta. A tinta revela invisíveis.' },
  }),
  daniel: P({
    id: 'daniel', nome: 'Daniel', cor: '#ff8a00', marca: 'nada', velocidade: 1,
    arma: { nome: 'Guarda-chuva', tipo: 'corpo', dano: 16, recarga: 0.6, alcance: 70, arcoGraus: 20 },
    ativa: { nome: 'Escudo', descricao: 'Abre o guarda-chuva em volta de si: bloqueia dano e projéteis de todos os lados por 5 s.', recarga: 10 },
    passiva: { nome: 'Chuva de agulhas', descricao: 'Quando o escudo acaba, solta 12 projéteis em todas as direções (3 de dano cada).' },
  }),
  lucas: P({
    id: 'lucas', nome: 'Lucas', cor: '#a6ff2e', marca: 'nada', velocidade: 1,
    arma: { nome: 'Raios elétricos', tipo: 'aura', dano: 5, recarga: 0.6, alcance: 75 },
    ativa: { nome: 'Onda de choque', descricao: 'Um anel elétrico que se expande longe, causa dano e empurra.', recarga: 10 },
    passiva: { nome: 'Estática', descricao: 'Quem acerta o Lucas (com qualquer ataque) leva 2 de dano de volta.' },
  }),
  pacheco: P({
    id: 'pacheco', nome: 'Pacheco', cor: '#19d3e6', marca: 'nada', velocidade: 1,
    arma: { nome: 'Mangueira', tipo: 'projetil', dano: 1, recarga: 1 / 18, alcance: 280, velocidadeProjetil: 620, estilo: 'gota', agua: true },
    ativa: { nome: 'Voo', descricao: 'Voa por 4 s por cima de obstáculos e água (a borda do mapa segura).', recarga: 7 },
    passiva: { nome: 'Nadador', descricao: 'Anda sobre a água, mas a lava queima o dobro.' },
  }),
  // ------------------------------------------------------------ 6 novos (primeira leva)
  sombra: P({
    id: 'sombra', nome: 'Sombra', cor: '#9b5cff', marca: 'triangulo', velocidade: 1.05,
    arma: { nome: 'Adagas', tipo: 'projetil', dano: 5, recarga: 0.5, alcance: 200, velocidadeProjetil: 720, estilo: 'adaga', projeteis: 2, leque: 7 },
    ativa: { nome: 'Invisível', descricao: 'Some por 5 s. Atacar revela; o primeiro acerto causa +50%. Tinta, dano e faro revelam.', recarga: 10 },
    passiva: { nome: 'Pelas costas', descricao: '+30% de dano em quem está de costas para ela.' },
  }),
  vampiro: P({
    id: 'vampiro', nome: 'Vampiro', cor: '#ff2fb4', marca: 'cruz', velocidade: 1,
    arma: { nome: 'Seringa', tipo: 'projetil', dano: 12, recarga: 0.9, alcance: 360, velocidadeProjetil: 600, estilo: 'dardo', rouboVida: 0.4 },
    ativa: { nome: 'Totem de sangue', descricao: 'Área que cura 5 por segundo só para ele, por 5 s.', recarga: 7 },
    passiva: { nome: 'Sede', descricao: 'Recupera 10 de vida ao eliminar alguém.' },
  }),
  engenheiro: P({
    id: 'engenheiro', nome: 'Engenheiro', cor: '#3d6bff', marca: 'quadrado', velocidade: 1,
    arma: { nome: 'Pistola de pregos', tipo: 'projetil', dano: 4, recarga: 0.9, alcance: 340, velocidadeProjetil: 800, estilo: 'prego', projeteis: 3, leque: 4 },
    ativa: { nome: 'Parede', descricao: 'Ergue à frente uma parede sólida por 5 s, que bloqueia tudo.', recarga: 6 },
    passiva: { nome: 'Blindado', descricao: 'Leva 20% menos dano de projéteis.' },
  }),
  pescador: P({
    id: 'pescador', nome: 'Pescador', cor: '#c0c8d8', marca: 'anel', velocidade: 1,
    arma: { nome: 'Rede', tipo: 'corpo', dano: 10, recarga: 0.8, alcance: 78, arcoGraus: 35 },
    ativa: { nome: 'Gancho', descricao: 'Lança um gancho que puxa o inimigo atingido até ele.', recarga: 2 },
    passiva: { nome: 'Ímã', descricao: 'Pega pickups a até 150 px de distância.' },
  }),
  gravidade: P({
    id: 'gravidade', nome: 'Gravidade', cor: '#00c98d', marca: 'ponto', velocidade: 0.95,
    arma: { nome: 'Orbe', tipo: 'projetil', dano: 9, recarga: 1.2, alcance: 400, velocidadeProjetil: 260, estilo: 'orbe', atravessa: true },
    ativa: { nome: 'Buraco negro', descricao: 'Por 2 s, puxa todos os inimigos para um ponto à frente.', recarga: 8 },
    passiva: { nome: 'Massa', descricao: 'Imune a empurrões e puxões.' },
  }),
  ilusionista: P({
    id: 'ilusionista', nome: 'Ilusionista', cor: '#e08a4f', marca: 'losango', velocidade: 1,
    arma: { nome: 'Bumerangue', tipo: 'projetil', dano: 9, recarga: 1.1, alcance: 300, velocidadeProjetil: 520, estilo: 'bumerangue', bumerangue: true },
    ativa: { nome: 'Clones', descricao: '5 cópias saem em direções diferentes por 4 s e enganam os outros.', recarga: 6 },
    passiva: { nome: 'Fuga', descricao: 'Uma vez por partida, ao cair abaixo de 25 de vida, fica invisível por 1,5 s.' },
  }),
  // ------------------------------------------------------------ 10 novos (segunda leva)
  atirador: P({
    id: 'atirador', nome: 'Atirador', cor: '#2a9bb0', marca: 'xis', velocidade: 1,
    arma: { nome: 'Rifle', tipo: 'projetil', dano: 14, recarga: 1, alcance: 520, velocidadeProjetil: 1100, estilo: 'bala', carga: { seg: 1.5, bonus: 1.5, bonusAlcance: 0.4 } },
    ativa: { nome: 'Corrida', descricao: 'Anda 50% mais rápido por 3 s.', recarga: 8 },
    passiva: { nome: 'Paciência', descricao: 'Parado por 1 s, o próximo tiro causa +25%. Leva 25% mais dano de golpes corpo a corpo.' },
  }),
  granadeiro: P({
    id: 'granadeiro', nome: 'Granadeiro', cor: '#8ea33a', marca: 'quadrado', velocidade: 1,
    arma: { nome: 'Granada', tipo: 'projetil', dano: 18, recarga: 1.6, alcance: 300, velocidadeProjetil: 480, estilo: 'granada', arco: true, explosao: { raio: 55, danoBorda: 8 } },
    ativa: { nome: 'Chuva de granadas', descricao: '5 granadas espalhadas numa área à frente.', recarga: 8 },
    passiva: { nome: 'Explosão final', descricao: 'Ao ser eliminado, explode e causa 20 de dano em volta.' },
  }),
  armadilheiro: P({
    id: 'armadilheiro', nome: 'Armadilheiro', cor: '#d8c39a', marca: 'barra', velocidade: 1,
    arma: { nome: 'Besta', tipo: 'projetil', dano: 11, recarga: 0.85, alcance: 420, velocidadeProjetil: 650, estilo: 'dardo' },
    ativa: { nome: 'Mina', descricao: 'Mina quase invisível: prende quem pisar por 1,5 s e causa 10. Até 3 minas.', recarga: 6 },
    passiva: { nome: 'Faro', descricao: 'Vê minas e invisíveis a até 150 px.' },
  }),
  gelo: P({
    id: 'gelo', nome: 'Gelo', cor: '#9fe6ff', marca: 'losango', velocidade: 1,
    arma: { nome: 'Cristais', tipo: 'projetil', dano: 7, recarga: 0.6, alcance: 380, velocidadeProjetil: 650, estilo: 'cristal', frio: true },
    ativa: { nome: 'Congelar', descricao: 'Congela por 1,5 s todos em volta e causa 8.', recarga: 8 },
    passiva: { nome: 'Pele fria', descricao: 'Quem o acerta corpo a corpo ganha 2 camadas de frio.' },
  }),
  veneno: P({
    id: 'veneno', nome: 'Veneno', cor: '#4fd12c', marca: 'triangulo', velocidade: 1,
    arma: { nome: 'Zarabatana', tipo: 'projetil', dano: 3, recarga: 0.7, alcance: 400, velocidadeProjetil: 600, estilo: 'dardo', veneno: { dano: 2, tiques: 4 } },
    ativa: { nome: 'Nuvem tóxica', descricao: 'Nuvem à frente que causa 5 por segundo a quem estiver dentro, por 6 s.', recarga: 8 },
    passiva: { nome: 'Antídoto', descricao: 'Imune a veneno e queimadura.' },
  }),
  hacker: P({
    id: 'hacker', nome: 'Hacker', cor: '#ff6ec7', marca: 'xis', velocidade: 1,
    arma: { nome: 'Pistola de pulso', tipo: 'projetil', dano: 8, recarga: 0.55, alcance: 400, velocidadeProjetil: 750, estilo: 'pulso' },
    ativa: { nome: 'Pane', descricao: 'Disparo que deixa o atingido sem habilidade ativa por 4 s e causa 5.', recarga: 3 },
    passiva: { nome: 'Glitch', descricao: 'Não aparece nas setas dos inimigos.' },
  }),
  relojoeiro: P({
    id: 'relojoeiro', nome: 'Relojoeiro', cor: '#e0b84a', marca: 'anel', velocidade: 1,
    arma: { nome: 'Ponteiros', tipo: 'projetil', dano: 5, recarga: 0.8, alcance: 320, velocidadeProjetil: 680, estilo: 'adaga', projeteis: 3, leque: 10 },
    ativa: { nome: 'Voltar no tempo', descricao: 'Volta para onde estava 5 s atrás (e recupera a vida, se era maior).', recarga: 9 },
    passiva: { nome: 'Eco', descricao: 'Ao voltar no tempo, solta uma pequena onda de choque que causa 5.' },
  }),
  berserker: P({
    id: 'berserker', nome: 'Berserker', cor: '#b3122e', marca: 'cruz', velocidade: 1,
    arma: { nome: 'Machado', tipo: 'corpo', dano: 18, recarga: 1, alcance: 66, arcoGraus: 75 },
    ativa: { nome: 'Fúria', descricao: 'Por 4 s, ataca 40% mais rápido e recupera 30% do dano causado.', recarga: 13 },
    passiva: { nome: 'Sangue quente', descricao: 'Quanto menos vida, mais dano (até +50%).' },
  }),
  domador: P({
    id: 'domador', nome: 'Domador', cor: '#9b6a3c', marca: 'ponto', velocidade: 1,
    arma: { nome: 'Estilingue', tipo: 'projetil', dano: 12, recarga: 0.8, alcance: 360, velocidadeProjetil: 520, estilo: 'pedra' },
    ativa: { nome: 'Drone', descricao: 'Um drone segue o Domador por 8 s e atira no inimigo mais próximo.', recarga: 14 },
    passiva: { nome: 'Companheiro', descricao: 'Cada eliminação tira 5 s da recarga do drone.' },
  }),
  espelho: P({
    id: 'espelho', nome: 'Espelho', cor: '#a9c6e8', marca: 'barra', velocidade: 1,
    arma: { nome: 'Cacos', tipo: 'projetil', dano: 5, recarga: 0.8, alcance: 260, velocidadeProjetil: 700, estilo: 'caco', projeteis: 3, leque: 8 },
    ativa: { nome: 'Reflexo', descricao: 'Por 3 s, devolve os projéteis para quem atirou.', recarga: 8 },
    passiva: { nome: 'Duplicata', descricao: 'Ao levar dano, 35% de chance de deixar um reflexo que confunde.' },
  }),
  // ------------------------------------------------------------ 8 novos (terceira leva)
  ninja: P({
    id: 'ninja', nome: 'Ninja', cor: '#5c7cfa', marca: 'xis', velocidade: 1.15,
    arma: { nome: 'Shuriken', tipo: 'projetil', dano: 7, recarga: 0.55, alcance: 380, velocidadeProjetil: 700, estilo: 'shuriken', ricochete: 2 },
    ativa: { nome: 'Avanço', descricao: 'Avança 200 px, atravessando inimigos e cortando quem estiver no caminho.', recarga: 7 },
    passiva: { nome: 'Leveza', descricao: 'Anda 15% mais rápido. As shurikens quicam 2 vezes nas paredes.' },
  }),
  tanque: P({
    id: 'tanque', nome: 'Tanque', cor: '#8c96a8', marca: 'quadrado', velocidade: 0.85, vida: 140,
    arma: { nome: 'Canhão', tipo: 'projetil', dano: 24, recarga: 1.4, alcance: 360, velocidadeProjetil: 380, estilo: 'bola', explosao: { raio: 40, danoBorda: 10 } },
    ativa: { nome: 'Investida', descricao: 'Avança 160 px, empurrando e causando 12 em quem estiver no caminho.', recarga: 11 },
    passiva: { nome: 'Couraça', descricao: '140 de vida, mas anda 15% mais devagar.' },
  }),
  medico: P({
    id: 'medico', nome: 'Médico', cor: '#7dffcf', marca: 'cruz', velocidade: 1,
    arma: { nome: 'Dardo', tipo: 'projetil', dano: 9, recarga: 0.7, alcance: 380, velocidadeProjetil: 650, estilo: 'dardo' },
    ativa: { nome: 'Kit', descricao: 'Cura 30 e remove efeitos ruins (veneno, queimadura, frio, prisão, lentidão, pane, marca).', recarga: 14 },
    passiva: { nome: 'Regeneração', descricao: 'Recupera 2 de vida por segundo depois de 3 s sem levar dano.' },
  }),
  cacador: P({
    id: 'cacador', nome: 'Caçador', cor: '#ff7f50', marca: 'triangulo', velocidade: 1,
    arma: { nome: 'Boleadeira', tipo: 'projetil', dano: 10, recarga: 1, alcance: 340, velocidadeProjetil: 560, estilo: 'boleadeira', prende: 0.6 },
    ativa: { nome: 'Marcar', descricao: 'Tiro que marca o alvo por 5 s: ele leva +25% de dano de todos e não fica invisível; as boleadeiras do Caçador viram teleguiadas até ele, com metade do dano.', recarga: 12 },
    passiva: { nome: 'Rastreador', descricao: '+20% de dano em alvos lentos ou presos.' },
  }),
  laserista: P({
    id: 'laserista', nome: 'Laserista', cor: '#d7a6ff', marca: 'barra', velocidade: 1,
    arma: { nome: 'Feixe', tipo: 'projetil', dano: 6, recarga: 0.45, alcance: 360, instantaneo: true },
    ativa: { nome: 'Sobrecarga', descricao: 'Por 3 s, o feixe recarrega na metade do tempo.', recarga: 10 },
    passiva: { nome: 'Foco', descricao: 'Acertos seguidos no mesmo alvo causam +1 cada (até +4).' },
  }),
  trocador: P({
    id: 'trocador', nome: 'Trocador', cor: '#00e5c0', marca: 'losango', velocidade: 1,
    arma: { nome: 'Bolhas', tipo: 'projetil', dano: 10, recarga: 0.8, alcance: 360, velocidadeProjetil: 480, estilo: 'bolha' },
    ativa: { nome: 'Troca', descricao: 'Troca de lugar com o inimigo mais próximo (até 700 px).', recarga: 5 },
    passiva: { nome: 'Desorientar', descricao: 'Depois da troca, o inimigo fica 30% mais lento por 1,5 s.' },
  }),
  bardo: P({
    id: 'bardo', nome: 'Bardo', cor: '#ffb3c7', marca: 'anel', velocidade: 1,
    arma: { nome: 'Notas', tipo: 'projetil', dano: 8, recarga: 0.65, alcance: 380, velocidadeProjetil: 560, estilo: 'nota' },
    ativa: { nome: 'Canção', descricao: 'Por 4 s, anda e ataca 35% mais rápido.', recarga: 7 },
    passiva: { nome: 'Refrão', descricao: 'A cada 4 acertos, a nota causa o dobro.' },
  }),
  astro: P({
    id: 'astro', nome: 'Astro', cor: '#ffe9a8', marca: 'losango', velocidade: 1,
    arma: { nome: 'Estrela cadente', tipo: 'projetil', dano: 16, recarga: 1.3, alcance: 420, velocidadeProjetil: 620, estilo: 'estrela' },
    ativa: { nome: 'Meteoro', descricao: 'Depois de 1 s de aviso, um meteoro cai à frente: 30 no centro, 12 na borda.', recarga: 12 },
    passiva: { nome: 'Constelação', descricao: 'Cada eliminação recarrega o meteoro na hora.' },
  }),
};

export const LISTA_PERSONAGENS = Object.values(PERSONAGENS);

/** Vida máxima do personagem. */
export const vidaMaxima = (id: IdPersonagem): number => PERSONAGENS[id].vida ?? 100;
export const IDS_PERSONAGENS = Object.keys(PERSONAGENS) as [IdPersonagem, ...IdPersonagem[]];

/** Valores das habilidades (fora do texto, para equilibrar). */
export const HABILIDADES = {
  teletransporte: { minimo: 260, maximo: 560 },
  flechaPreparada: { bonusDano: 0.5, bonusRaio: 0.4 },
  giro: { raio: 82, dano: 14, empurrao: 90, queimadura: { dano: 4, tiques: 3 } },
  /** Poças de tinta do Vini. `lentidao` = fator de velocidade dos inimigos dentro da poça. */
  tinta: { raio: 40, segDuracao: 4, maxPocas: 5, lentidao: 0.5, surfista: 1.3 },
  balde: { raio: 110, segDuracao: 5, empurrao: 40 },
  /** Escudo do Daniel: protege um arco em volta da mira (180° para cada lado = 360°, todos os lados). */
  escudo: { segDuracao: 5, arcoGraus: 180, raio: 26 },
  adrenalina: { fator: 1.5, segDuracao: 1.5, segRecarga: 5 },
  /** Lentidão do choque do Lucas (fica no inimigo; com a tinta, vale a maior). */
  choque: { lentidao: 0.7, segDuracao: 1.2 },
  onda: { raioMax: 380, segExpansao: 0.5, dano: 16, empurrao: 130 },
  estatica: { dano: 2 },
  voo: { segDuracao: 4, fatorVelocidade: 1.25 },
  // novos
  invisivel: { segDuracao: 5, bonusEmboscada: 0.5 },
  costas: { bonus: 0.3 },
  totem: { raio: 90, segDuracao: 5, curaPorSeg: 5 },
  sede: { cura: 10 },
  parede: { comprimento: 96, espessura: 16, distancia: 48, segDuracao: 5 },
  blindado: { reducao: 0.2 },
  gancho: { alcance: 420, velocidade: 850, dano: 6, distanciaFinal: 34 },
  ima: { raio: 150 },
  buraco: { distancia: 220, raio: 260, segDuracao: 2, puxaoPorSeg: 150, danoPorSeg: 4 },
  clone: { segDuracao: 4, quantidade: 5 },
  fuga: { limiteVida: 25, segDuracao: 1.5 },
  laser: { segDuracao: 3 },
  corrida: { segDuracao: 3, fator: 1.5 },
  corpoAtirador: { extra: 0.25 },
  paciencia: { segParado: 1, bonus: 0.25 },
  chuva: { distancia: 240, espalhamento: 90, quantidade: 5, intervalo: 0.15, raio: 45, dano: 12 },
  explosaoFinal: { raio: 80, dano: 20 },
  mina: { maximo: 3, raioGatilho: 22, raioVisivel: 70, dano: 10, segPreso: 1.5 },
  faro: { raio: 150 },
  /** Frio: cada camada = 10% de lentidão, até 5 camadas; dura 3 s (renova a cada acerto). */
  frio: { porCamada: 0.1, maxCamadas: 5, segDuracao: 3 },
  congelar: { raio: 140, segDuracao: 1.5, dano: 8 },
  peleFria: { camadas: 2 },
  nuvem: { distancia: 200, raio: 110, segDuracao: 6, danoPorSeg: 5 },
  pane: { segDuracao: 4, dano: 5, velocidade: 900, alcance: 450 },
  rebobinar: { segAtras: 5 },
  eco: { raio: 90, dano: 5 },
  furia: { segDuracao: 4, fatorRecarga: 1 / 1.4, rouboVida: 0.3 },
  sangueQuente: { bonusMax: 0.5 },
  drone: { segDuracao: 8, intervalo: 0.7, alcance: 300, dano: 4, velocidade: 600, distancia: 34 },
  companheiro: { reducaoSeg: 5 },
  reflexo: { segDuracao: 3 },
  duplicata: { chance: 0.35, segDuracao: 2 },
  agulhas: { quantidade: 12, dano: 3, alcance: 260, velocidade: 600 },
  lavaPacheco: { fator: 2 },
  guiado: { fatorDano: 0.5, giroPorSeg: 6 },
  avanco: { distancia: 200, dano: 10, largura: 24 },
  investida: { distancia: 160, dano: 12, empurrao: 80, largura: 28 },
  kit: { cura: 30 },
  regeneracao: { segSemDano: 3, porSeg: 2 },
  marca: { segDuracao: 5, bonus: 0.25, dano: 6, velocidade: 700, alcance: 420 },
  rastreador: { bonus: 0.2 },
  sobrecarga: { segDuracao: 3, fatorRecarga: 0.5 },
  foco: { maximo: 4 },
  troca: { velocidade: 700, alcance: 700, dano: 4, segDesorientado: 1.5 },
  cancao: { segDuracao: 4, fator: 1.35 },
  refrao: { cada: 4 },
  meteoro: { distancia: 260, segAviso: 1, raio: 110, dano: 30, danoBorda: 12 },
} as const;
