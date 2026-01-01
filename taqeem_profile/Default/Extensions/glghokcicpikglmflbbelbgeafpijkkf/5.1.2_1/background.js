//Chrome
var port = chrome.runtime.connectNative("signer.digital.chrome.host");

//Receive Message From Content 
chrome.runtime.onMessage.addListener(
  function(request, sender, sendResponse) {
    console.log(sender.tab ?
                "from a content script:" + sender.tab.url :
                "From the extension: " + request);	
	//alert("Extension Received :" +JSON.stringify(request));
   if (port == null )
   {
	chrome.windows.create({url: "popup.html", type:"popup", top:100, left:100, width:630,height:320});
	//Jan 2024 - alert is not working - alert("Error: Check if [Signer.Digital Extension] Application is installed.\nDownload link for Windows:\nhttps://downloads.signer.digital/Signer.Digital.Browser.Extension.Setup.msi\nVisit www.signer.digital to download Linux Hosts."); 
	return true;	//To prevent error The message port closed before a response was received.
   }
   //Message to host   
   port.postMessage(request);	
   return true;	  	//To prevent error The message port closed before a response was received.
  });

//Receive Message from Host
port.onMessage.addListener(function(msg) {
  //alert("Received from host" + JSON.stringify(msg));
  
  //Send msg to content script
  chrome.windows.getCurrent(w => {
	  chrome.tabs.query({active: true, windowId: w.id}, function(tabs){
		chrome.tabs.sendMessage(tabs[0].id,msg, function(response) {});  
	  });
  });
  
});

//Receive message from Popup - chrome.runtime.sendMessage
//chrome.extension.onRequest.addListener(
//   function(request, sender, sendResponse){
//        console.log(request + "------------ hello");
//    }
//);

port.onDisconnect.addListener(function() {
  port = null;
  console.log("SD Host Application Disconnected - " + chrome.runtime.lastError.message);
  if (chrome.runtime.lastError.message.indexOf("native messaging host not found") > 0)
	   chrome.windows.create({url: "popup.html", type:"popup", top:100, left:100, width:630,height:320});
});  