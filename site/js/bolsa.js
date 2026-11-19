(function(){
  var cover='https://www.rockstargames.com/VI/_next/static/media/Official_Cover_Art_landscape.12.uu2irr.2_a.jpg?akim=1&imdensity=1&imwidth=3840';
  var format='fisica';
  function checkout(value){
    try{localStorage.setItem('gtaViFormat',value);}catch(_){}
    return '/pagamento?produto=GRAND_THEFT_AUTO_VI&amount=247.00&formato='+encodeURIComponent(value);
  }
  function setFormat(value){
    format=value;
    document.querySelectorAll('[data-gta-format]').forEach(function(b){
      var active=b.getAttribute('data-gta-format')===value;
      b.classList.toggle('is-selected',active);
      b.setAttribute('aria-pressed',active?'true':'false');
    });
  }
  function addModal(){
    if(document.getElementById('bolsa-color-modal'))return;
    var modal=document.createElement('div');
    modal.id='bolsa-color-modal';
    modal.className='bolsa-modal';
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML='<div class="bolsa-modal__backdrop"></div><section class="bolsa-modal__dialog" role="dialog" aria-modal="true" aria-label="Escolha o formato do jogo"><button class="bolsa-modal__close" type="button" aria-label="Fechar">×</button><img src="'+cover+'" alt="Grand Theft Auto VI para PS5"><h2>Escolha o formato do jogo</h2><div class="bolsa-modal__colors"><button type="button" data-gta-format="fisica">Mídia física</button><button type="button" data-gta-format="digital">Digital</button></div><button type="button" class="bolsa-modal__confirm">Continuar para pagamento</button></section>';
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-gta-format]').forEach(function(b){
      b.addEventListener('click',function(){setFormat(b.getAttribute('data-gta-format'));});
    });
    function close(){modal.classList.remove('is-open');modal.setAttribute('aria-hidden','true');}
    modal.querySelector('.bolsa-modal__close').addEventListener('click',close);
    modal.querySelector('.bolsa-modal__backdrop').addEventListener('click',close);
    modal.querySelector('.bolsa-modal__confirm').addEventListener('click',function(){location.href=checkout(format);});
    setFormat(format);
  }
  function bindBuy(){
    document.querySelectorAll('[data-product-buy="true"]').forEach(function(link){
      link.addEventListener('click',function(e){
        e.preventDefault();
        var modal=document.getElementById('bolsa-color-modal');
        modal.classList.add('is-open');
        modal.setAttribute('aria-hidden','false');
        setFormat(format);
      });
    });
  }
  function boot(){addModal();bindBuy();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
