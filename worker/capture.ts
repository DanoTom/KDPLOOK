/**
 * The browser-side collector.
 *
 * Amazon answers a person's browser with the whole shelf and a datacenter with
 * a short page or a refusal, so the reliable way to read a search is to have
 * the browser that is already logged in do the reading. This is the code that
 * runs there: it takes the results page it is standing on, follows the book
 * pages behind it in the same session, trims each one to the regions the
 * parsers actually look at, and posts the bundle back.
 *
 * It ships as a bookmarklet — one self-contained `javascript:` URL — because
 * Amazon's content policy blocks loading a script from anywhere else.
 *
 * Nothing here parses: the same parsers on the server read what arrives, so a
 * fix to them fixes both paths at once and the two cannot drift apart.
 */

/** Regions of a book page worth sending. Everything else is navigation. */
const DETAIL_SELECTORS = [
  "#productTitle", "#title", "#bylineInfo", "#productSubtitle",
  '[id*="detailBullets"]', '[id^="productDetails_"]', "#prodDetails", "#productDetailsTable",
  "#richProductInformation_feature_div", "[data-rpi-attribute-name]",
  '[id^="corePrice"]', "#averageCustomerReviews", "#acrCustomerReviewText",
  "#formats", "#tmmSwatches",
].join(",");

export interface BookmarkletOptions {
  /** Where to post the bundle. */
  appOrigin: string;
  /** Authorises the post; the session cookie does not travel cross-origin. */
  token: string;
}

/**
 * Build the bookmarklet.
 *
 * Written as one string rather than compiled from a module because it has to
 * survive being pasted into a bookmark: no imports, no build step, no reliance
 * on anything the page happens to have loaded.
 */
export function bookmarkletSource({ appOrigin, token }: BookmarkletOptions): string {
  const source = `(async function(){
  var APP=${JSON.stringify(appOrigin)},TOKEN=${JSON.stringify(token)},SEL=${JSON.stringify(DETAIL_SELECTORS)};
  var box=document.createElement("div");
  box.setAttribute("style","position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:320px;padding:14px 16px;border-radius:12px;font:13px/1.5 -apple-system,system-ui,sans-serif;background:#1b1b1f;color:#f4f4f5;box-shadow:0 10px 40px rgba(0,0,0,.4)");
  document.body.appendChild(box);
  var say=function(t){box.innerHTML=t;};
  say("KDPLOOK: leyendo la p\\u00e1gina\\u2026");

  try{
    var url=new URL(location.href);
    if(url.pathname.indexOf("/s")!==0){say("Abre primero una <b>b\\u00fasqueda</b> de Amazon y vuelve a pulsar.");return;}
    var keyword=url.searchParams.get("k")||"";
    if(!keyword){say("No se ve qu\\u00e9 se busc\\u00f3 en esta p\\u00e1gina.");return;}
    var alias=url.searchParams.get("i")||"";
    var department=alias.indexOf("digital")===0?"kindle":alias?"print":"all";
    var market=location.hostname.replace(/^www\\.amazon\\./,"");

    // Strip the scripts: they are most of the weight and none of the meaning.
    var clean=function(el){
      if(!el)return "";
      var copy=el.cloneNode(true);
      var junk=copy.querySelectorAll("script,style,noscript");
      for(var i=0;i<junk.length;i++)junk[i].parentNode.removeChild(junk[i]);
      return copy.outerHTML;
    };

    // #search first, not .s-main-slot: the "1-16 de más de 2.000 resultados"
    // line lives in a bar *above* the results, and that count is one of the
    // hard gates the report is judged on. Trimming to the list threw it away.
    var slot=document.getElementById("search")||document.querySelector(".s-main-slot")||document.querySelector('[data-component-type="s-search-results"]')||document.body;
    var searchHtml=clean(slot);

    var cards=document.querySelectorAll('[data-component-type="s-search-result"][data-asin]');
    var asins=[],seen={};
    for(var c=0;c<cards.length;c++){
      var a=cards[c].getAttribute("data-asin");
      // Ads are bought placements, not the organic shelf the report describes.
      var ad=cards[c].querySelector('[data-component-type="sp-sponsored-result"],.puis-sponsored-label-text,.s-sponsored-label-text');
      if(a&&a.length===10&&!seen[a]&&!ad){seen[a]=1;asins.push(a);}
    }
    asins=asins.slice(0,20);

    // Only the regions the parsers read, and never the whole page: twenty raw
    // book pages would be thirty megabytes.
    var trim=function(html){
      var doc=new DOMParser().parseFromString(html,"text/html");
      var hits=doc.querySelectorAll(SEL),keep=[];
      for(var i=0;i<hits.length;i++){
        var nested=false;
        for(var j=0;j<hits.length;j++){if(i!==j&&hits[j].contains(hits[i])){nested=true;break;}}
        if(!nested)keep.push(clean(hits[i]));
      }
      return keep.join("\\n").slice(0,150000);
    };

    var details=[],done=0;
    var fetchOne=async function(asin){
      try{
        var res=await fetch("/dp/"+asin+"?language="+encodeURIComponent(document.documentElement.lang||""),{credentials:"include"});
        if(res.ok)details.push({asin:asin,html:trim(await res.text())});
      }catch(e){/* one book missing beats the whole capture failing */}
      done++;
      say("KDPLOOK: leyendo fichas\\u2026 <b>"+done+"/"+asins.length+"</b>");
    };

    // Three at a time, with a pause: this is a person's own session and it
    // should read like one.
    for(var k=0;k<asins.length;k+=3){
      await Promise.all(asins.slice(k,k+3).map(fetchOne));
      await new Promise(function(r){setTimeout(r,400);});
    }

    say("KDPLOOK: enviando\\u2026");
    var payload={token:TOKEN,keyword:keyword,marketplace:market,department:department,searchHtml:searchHtml,details:details};

    try{
      var out=await fetch(APP+"/api/capture",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      var data=await out.json();
      if(!out.ok)throw new Error(data&&data.error||"rechazado");
      say('Listo: <b>'+(data.analysed||0)+' libros</b>.<br><a style="color:#f0a33e" target="_blank" href="'+APP+"/nicho?id="+data.id+'">Ver el informe \\u2192</a>');
      return;
    }catch(err){
      // Amazon's content policy can block the post. The capture is already in
      // hand, so hand it over another way rather than throwing it away.
      try{
        await navigator.clipboard.writeText(JSON.stringify(payload));
        say("Amazon bloque\\u00f3 el env\\u00edo, as\\u00ed que la captura est\\u00e1 <b>copiada al portapapeles</b>.<br>P\\u00e9gala en KDPLOOK \\u2192 Explorar nicho \\u2192 Importar captura.");
      }catch(e2){
        say("No se pudo enviar ni copiar: "+(err&&err.message||err));
      }
    }
  }catch(fatal){
    say("Fall\\u00f3: "+(fatal&&fatal.message||fatal));
  }
})();`;
  return `javascript:${encodeURIComponent(source)}`;
}
