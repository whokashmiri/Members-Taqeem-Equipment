console.log("CISPL SignerDigital Loaded");

let SDLogToConsole = false;

//Event to set SDLogToConsole value from user page or from browser console
document.addEventListener("ConsoleLogging", function (e){
	if(e.detail.toUpperCase() == "ON")
		SDLogToConsole = true;
	else
		SDLogToConsole = false;
});

//Get Message from Page  (i.e. sdscript -> messagePromise -> window.postMessage(msg, "*"); -> this Listner )
window.addEventListener("message", function(event) {
  // We only accept messages from ourselves
    if (event.source !== window)
        return;

  if (event.data.src && (event.data.src === "user_page.js")) {  
	if(SDLogToConsole)
	{
		console.log("From page: ");
		console.log(event.data);
	}
	//Send Message to Extension
	chrome.runtime.sendMessage(event.data,function(resp){});
  }
}, false);

//Get Message from Extension Host
 chrome.runtime.onMessage.addListener(
	function(respFromHost, sender, sendResponse) {
		
		//console.log(respFromHost);
		//console.log(sender.tab ? "from a content script:" + sender.tab.url :"from the extension");													 
		if(SDLogToConsole)
		{
			console.log("From Extension Host: ");
			console.log(respFromHost);
		}
		//sendResponse(request);	
        // post messages to page
		if(respFromHost.src != "popup.js")
		{
			respFromHost.src ="content.js";
		}
		window.postMessage(respFromHost, '*');
		return true;
	}
  );
  //Inject HTML to Show SD Popups in Loaded Page
//Ref: https://stackoverflow.com/a/16336073/9659885
fetch(chrome.runtime.getURL('/sdstyle.css'))
	.then(r => r.text())
	.then(html => {
		document.head.insertAdjacentHTML('beforeend', html);
   // not using innerHTML as it would break js event listeners of the page
	 });
fetch(chrome.runtime.getURL('/SdHtmlPage.html'))
	.then(r => r.text())
	.then(html => {
		if(document.body != null)
		{
			document.documentElement.insertAdjacentHTML('beforeend', html);
			
			//Load Image in Header
			document.getElementById("SDIconSelCert").src = chrome.runtime.getURL('/icon32.png');
			document.getElementById("SDIconSCPin").src = chrome.runtime.getURL('/icon32.png');
			document.getElementById("SDIconLicSite").src = chrome.runtime.getURL('/icon32.png');
			document.getElementById("trash_icon_src").src = chrome.runtime.getURL('/icon_trash.svg');
		}
	});


	  
/////// inject content of sdscript.js to the DOM of page  ///////////////
var s = document.createElement('script');
s.src = chrome.runtime.getURL('sdscript.js');
(document.head || document.documentElement).appendChild(s);
s.onload = function() {
    this.remove();
};

