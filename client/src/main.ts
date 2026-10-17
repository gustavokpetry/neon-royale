import './estilo.css';
import { iniciarApp } from './ui/app';
import { instalarDestrave } from './audio/som';

document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => {
  if ((e.target as HTMLElement).closest('#jogo')) e.preventDefault();
});
instalarDestrave();
iniciarApp();
