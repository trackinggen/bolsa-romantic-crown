/* Resume an actual order payment when the buyer returns from the banking app. */
(function(){
  var txId;try{txId=localStorage.getItem('lastPixTx');}catch(e){return;}
  if(!txId||localStorage.getItem('pixPaid_'+txId))return;
  var at=Number(localStorage.getItem('lastPixTxAt'))||0;
  if(!at||Date.now()-at>6*3600000)return;
  var done=false,busy=false,timer;
  function check(){
    if(done||busy||document.visibilityState==='hidden')return;
    busy=true;
    fetch('/api/public/pix/status?id='+encodeURIComponent(txId),{cache:'no-store'})
      .then(function(r){if(!r.ok)return null;return r.json();})
      .then(function(data){
        if(!data||data.status!=='paid')return;
        done=true;clearInterval(timer);
        try{localStorage.setItem('pixPaid_'+txId,'1');localStorage.removeItem('lv_pix_cache');sessionStorage.removeItem('lv_avem_request');}catch(e){}
        if(window.lvGo)window.lvGo('/pedido-confirmado');else window.top.location.href='/pedido-confirmado';
      }).catch(function(){}).finally(function(){busy=false;});
  }
  check();timer=setInterval(check,15000);
  window.addEventListener('focus',check);
  document.addEventListener('visibilitychange',check);
})();
