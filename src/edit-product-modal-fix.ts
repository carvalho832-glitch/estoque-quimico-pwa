function installEditProductModalFix(): void {
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>('.card-actions .ghost-button');
      if (!button || button.textContent?.trim() !== 'Editar') return;

      const card = button.closest<HTMLDetailsElement>('.product-card');
      if (card) card.open = false;

      window.setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 80);
    },
    true,
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installEditProductModalFix, { once: true });
} else {
  installEditProductModalFix();
}
