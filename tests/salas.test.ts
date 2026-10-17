import { describe, expect, it } from 'vitest';
import { Salas } from '../server/src/salas';

const rng = { inteiro: (min: number, max: number) => Math.floor((min + max) / 2) };

describe('salas', () => {
  it('até 6 jogadores, cada um com um personagem diferente; começa com 2 ou mais', () => {
    const s = new Salas(rng, () => 0);
    const { sala, jogador: a } = s.criar('Ana', 's1');
    const b = s.entrar(sala.codigo, 'Beto', 's2').jogador;
    expect([a.personagem, b.personagem]).toEqual(['veni', 'gut']);
    s.pronto(b.token, true);
    expect(s.podeIniciar(sala)).toBe(true);
    const c = s.entrar(sala.codigo, 'Caio', 's3').jogador;
    expect(c.personagem).toBe('vini');
    expect(s.podeIniciar(sala)).toBe(false); // Caio ainda não está pronto
    s.pronto(c.token, true);
    expect(s.podeIniciar(sala)).toBe(true);
    const d = s.entrar(sala.codigo, 'Davi', 's4').jogador;
    expect(d.personagem).toBe('daniel');
    s.pronto(d.token, true);
    const f = s.entrar(sala.codigo, 'Eva', 's5').jogador;
    expect(f.personagem).toBe('lucas');
    s.pronto(f.token, true);
    const g = s.entrar(sala.codigo, 'Gabi', 's6').jogador;
    expect(g.personagem).toBe('pacheco');
    s.pronto(g.token, true);
    expect(() => s.entrar(sala.codigo, 'Hugo', 's7')).toThrow(/cheia/);
    expect(() => s.escolher(c.token, 'gut')).toThrow(/escolhido/);
    s.iniciar(a.token);
    expect(sala.jogo?.lutadores.size).toBe(6);
  });

  it('o Pega Bandeira só aceita os mapas feitos para ele', () => {
    const s = new Salas(rng, () => 0);
    const { sala, jogador: a } = s.criar('Ana', 's1');
    const b = s.entrar(sala.codigo, 'Beto', 's2').jogador;
    s.pronto(b.token, true);
    expect(sala.mapa).toBe('praca');
    s.escolherModo(a.token, 'bandeira');
    expect(sala.mapa).toBe('colmeia'); // trocou sozinho
    expect(() => s.escolherMapa(a.token, 'praca')).toThrow(/Pega Bandeira/);
    s.escolherMapa(a.token, 'encruzilhada');
    expect(sala.mapa).toBe('encruzilhada');
    s.escolherModo(a.token, 'royale');
    s.escolherMapa(a.token, 'praca'); // nos outros modos, qualquer mapa
    expect(sala.mapa).toBe('praca');
  });

  it('o anfitrião expulsa jogadores; ninguém mais pode; não dá para se expulsar', () => {
    const s = new Salas(rng, () => 0);
    const { sala, jogador: a } = s.criar('Ana', 's1');
    const b = s.entrar(sala.codigo, 'Beto', 's2').jogador;
    const c = s.entrar(sala.codigo, 'Caio', 's3').jogador;
    expect(() => s.expulsar(b.token, c.id)).toThrow(/anfitrião/);
    expect(() => s.expulsar(a.token, a.id)).toThrow(/sair/);
    const r = s.expulsar(a.token, b.id);
    expect(r.socketId).toBe('s2');
    expect(sala.jogadores.map((j) => j.apelido)).toEqual(['Ana', 'Caio']);
    expect(s.sessao(b.token)).toBeUndefined();
    // no meio da partida também: o expulso é eliminado
    s.pronto(c.token, true);
    s.iniciar(a.token);
    s.expulsar(a.token, c.id);
    expect(sala.jogo?.lutadores.get(c.id)?.vivo).toBe(false);
  });
});
