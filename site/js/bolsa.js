(function(){
  var colors = {
    Preto: '/site/images/bolsa/bolsa-1.webp',
    Branco: '/site/images/bolsa/bolsa-2.jpg',
    Marrom: '/site/images/bolsa/bolsa-3.jpg'
  };
  function queryColor(){
    try { return new URLSearchParams(location.search).get('cor') || localStorage.getItem('lvBolsaColor') || 'Preto'; }
    catch (_) { return 'Preto'; }
  }
  function setColor(color){
    if(!colors[color]) color='Preto';
    try { localStorage.setItem('lvBolsaColor', color); } catch (_) {}
    document.querySelectorAll('[data-bolsa-color]').forEach(function(button){
      var chosen = button.getAttribute('data-bolsa-color') === color;
      button.setAttribute('aria-pressed', chosen ? 'true' : 'false');
      button.classList.toggle('is-selected', chosen);
    });
    document.querySelectorAll('[data-product-buy="true"]').forEach(function(link){
      link.href = '/pagamento?produto=BOLSA_TRANSVERSAL&amount=34.90&cor=' + encodeURIComponent(color);
    });
    document.querySelectorAll('[data-bolsa-selected]').forEach(function(el){ el.textContent=color; });
  }
  function addPicker(){
    var buy = document.querySelector('[data-product-buy="true"]');
    if(!buy || document.getElementById('bolsa-color-picker')) return;
    var panel=document.createElement('section');
    panel.id='bolsa-color-picker';
    panel.className='mx-3 mb-4 p-3 rounded-xl border border-neutral-200 bg-white';
    panel.innerHTML='<div class="flex items-center justify-between gap-3"><div><p class="m-0 text-[13px] font-bold text-neutral-900">Escolha a cor</p><p class="m-0 mt-1 text-[11px] text-neutral-500">Selecionada: <strong data-bolsa-selected></strong></p></div></div><div class="flex gap-2 mt-3">'+Object.keys(colors).map(function(color){ return '<button type="button" data-bolsa-color="'+color+'" class="bolsa-color-button" aria-pressed="false"><span class="bolsa-swatch '+color.toLowerCase()+'"></span>'+color+'</button>'; }).join('')+'</div>';
    var nav=buy.closest('nav');
    nav.parentNode.insertBefore(panel,nav);
    panel.querySelectorAll('[data-bolsa-color]').forEach(function(button){ button.addEventListener('click',function(){ setColor(button.getAttribute('data-bolsa-color')); }); });
  }
  function applyBrand(){
    var logo=document.createElement('img');
    logo.id='bolsa-store-logo'; logo.src='/site/images/bolsa/romantic-crown-logo.jpg'; logo.alt='Romantic Crown';
    var marker=[].slice.call(document.querySelectorAll('*')).find(function(el){ return el.children.length===0 && el.textContent.trim()==='Romantic Crown'; });
    if(marker && !document.getElementById('bolsa-store-logo')) { marker.insertAdjacentElement('beforebegin',logo); }
  }
  function applyProduct(){
    var color=queryColor();
    document.querySelectorAll('img[src*="/site/images/bolsa/"]').forEach(function(img){
      if(img.src.indexOf('romantic-crown-logo')===-1 && /bolsa-[123]/.test(img.src)) img.src=colors[color];
    });
    setColor(color);
  }
  function boot(){ addPicker(); applyBrand(); applyProduct(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();