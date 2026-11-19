(function(){
  var format='fisica';
  var buttons=document.querySelectorAll('[data-format]');
  function select(value){format=value;buttons.forEach(function(b){var active=b.getAttribute('data-format')===value;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active?'true':'false');});}
  buttons.forEach(function(b){b.addEventListener('click',function(){select(b.getAttribute('data-format'));});});
  var buy=document.getElementById('buy');
  if(buy)buy.addEventListener('click',function(){try{localStorage.setItem('gtaViFormat',format);}catch(e){}location.href='/pagamento?produto=GRAND_THEFT_AUTO_VI&amount=247.00&formato='+encodeURIComponent(format);});
})();
