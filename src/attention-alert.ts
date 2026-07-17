function updateAttentionCard(): void {
  const attentionCard = document.querySelector<HTMLElement>('.stats-grid article:nth-child(4)');
  const attentionValue = attentionCard?.querySelector('strong')?.textContent ?? '0';
  const attentionCount = Number.parseInt(attentionValue, 10) || 0;

  if (!attentionCard) return;

  attentionCard.classList.toggle('attention-alert-active', attentionCount > 0);
  attentionCard.setAttribute('aria-label', attentionCount > 0
    ? `${attentionCount} produto(s) exigem atenção`
    : 'Nenhum produto exige atenção');
}

function startAttentionCardObserver(): void {
  updateAttentionCard();

  const observer = new MutationObserver(() => updateAttentionCard());
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startAttentionCardObserver, { once: true });
} else {
  startAttentionCardObserver();
}
