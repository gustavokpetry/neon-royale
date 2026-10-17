/** Escapa texto para inserir em HTML (apelidos vêm de outros jogadores). */
export function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * Copia texto. Sem HTTPS, navigator.clipboard não existe, então usa execCommand
 * e, se falhar, seleciona o texto para o jogador copiar manualmente.
 */
export async function copiarTexto(texto: string, elementoParaSelecionar?: HTMLElement | null): Promise<'copiado' | 'selecionado'> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(texto);
      return 'copiado';
    }
  } catch {
    /* segue para o fallback */
  }
  const ta = document.createElement('textarea');
  ta.value = texto;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, texto.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  if (ok) return 'copiado';
  if (elementoParaSelecionar) {
    const r = document.createRange();
    r.selectNodeContents(elementoParaSelecionar);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  }
  return 'selecionado';
}

const CHAVE_PREFS = 'jogo99:preferencias';
export interface Preferencias {
  volume: number;
  mostrarLatencia: boolean;
  apelido: string;
}
export function lerPreferencias(): Preferencias {
  const padrao: Preferencias = { volume: 0.7, mostrarLatencia: true, apelido: '' };
  try {
    return { ...padrao, ...(JSON.parse(localStorage.getItem(CHAVE_PREFS) ?? '{}') as Partial<Preferencias>) };
  } catch {
    return padrao;
  }
}
export function salvarPreferencias(p: Partial<Preferencias>): void {
  try {
    localStorage.setItem(CHAVE_PREFS, JSON.stringify({ ...lerPreferencias(), ...p }));
  } catch {
    /* navegação privada sem storage: preferências só valem nesta aba */
  }
}
