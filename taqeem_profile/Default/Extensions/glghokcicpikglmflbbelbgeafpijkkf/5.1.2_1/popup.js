
document.getElementById('btnOpenManageLicPopup').addEventListener('click', ShowManageLicPopup);



function ShowManageLicPopup ()
{
//	chrome.runtime.sendMessage({ action: "ManageLicSites"});
	chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
		chrome.tabs.sendMessage(tabs[0].id, {src:"popup.js", action:"ManageLicSites"});
	});
}

