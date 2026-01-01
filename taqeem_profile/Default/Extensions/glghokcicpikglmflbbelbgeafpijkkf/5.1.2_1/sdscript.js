// Promises
var _tp_promises = {};
var SignerDigital= new SDCrypto();
function SDCrypto (){
var LicensedSites;		//List of all Licensed (and not licensed) sites added in server config file...
var OSName = GetOS();
//var OSSupported = (OSName == "Windows" || OSName == "Linux") ? true : false; 
//Get Host details
var hostDetails;
var IsNewHostVer;
var SCPinSet = false;


//Get Message From content script (On reciving reponse from Ext Host);
window.addEventListener("message", function(event) {
		if(event.source !== window) return;
		if(event.data.src && (event.data.src === "content.js")) {
			//console.log("Page received: ");
			//console.log(event.data);
			// Get the promise
			if(event.data.nonce) {
				 var p = _tp_promises[event.data.nonce];
				 if (p == undefined)
				 {
					//Check for Host_Raised_SC_Event
					if(event.data.host_event == "SC_Event")
						SCPinSet = false;

					return false;
				 }
				 // resolve
				 if(event.data.status_cd === 1)
				 {
					p.resolve(event.data.result);
				 }
				 else
				 {
					p.reject(new Error(event.data.result));
				 }
				 delete _tp_promises[event.data.nonce];
			}else {
				console.log("No nonce in event msg");
			}
		}
		if(event.data.src && (event.data.src == "popup.js"))
			switch(event.data.action)
			{
				case "ManageLicSites":
					SignerDigital.ManageLicSites();
			}
	});
		
	function nonce() {
	  var val = "";
	  var hex = "abcdefghijklmnopqrstuvwxyz0123456789";
	  for(var i = 0; i < 16; i++)
		val += hex.charAt(Math.floor(Math.random() * hex.length));
	  return val;
	}

	function messagePromise(msg, checkSiteLicFeature) {
		return new Promise(async function(sdResolve, sdReject) {
			// amend with necessary metadata
			msg["origin"] = location.origin;
			msg["nonce"] = nonce();
			msg["src"] = "user_page.js"; 			
			msg["browser"] = "firefox";
			// and store promise callbacks
			_tp_promises[msg.nonce] = {
				resolve: sdResolve,
				reject: sdReject
			};
			//Get host Version
			if(IsNewHostVer == undefined && checkSiteLicFeature != "Init")		//checkSiteLicFeature != "Init" condition required to prevent recursion - make single entry in this block
			{
				hostDetailsJson = await messagePromise({ action:"GetHostDetails"}, "Init");
				hostDetails = JSON.parse(hostDetailsJson);
				IsNewHostVer = hostDetails.SDHostVersion.localeCompare("5.0.0", undefined, { numeric: true, sensitivity: 'base' }) >= 0 ? true : false;
			}
			if (msg["action"] == "")		//Return the call if it is (dummy call) from function showLicSitesPopup just to set IsNewHostVer
				return;
			
			//Check for License			
			if (IsNewHostVer && checkSiteLicFeature != undefined)		//Actions (APIs - say Signing actions) which require License would pass checkSiteLicFeature to value against which feature should be checked
			{
				if(LicensedSites == undefined)
				{
					licSitesJson = await messagePromise({ action:"GetOrAllowLicensedSites"}) ;
					LicensedSites = JSON.parse(licSitesJson);
				}
				var chkSitLicResult = CheckSiteInLicensedSites(checkSiteLicFeature);
				
				if(chkSitLicResult.licErrorMsg != undefined)
				{
					delete _tp_promises[msg.nonce];			
					sdReject(new Error("SDHost Error: " + chkSitLicResult.licErrorMsg));
					return;
				}				
				if(!chkSitLicResult.siteFound)		//Note: Host would also include all checked sites in "Not Licensed" so that there is no repeated API calls to CISPL Lic server to check Licensed Sites 
				{
					try
					{
						await showLicSitesPopup(true, checkSiteLicFeature);
					}
					catch(LicSiteErr)
					{
						delete _tp_promises[msg.nonce];	
						sdReject(new Error(LicSiteErr));
						return;
					}
				}
			}
			//Show SelCertPopup in case action requires selection of certificate (if certThumbPrint is empty)
			if(IsNewHostVer && msg.certThumbPrint == "" && (msg.action == "GetSelCertFromToken" || msg.action.includes("Sign") || msg.action.startsWith("Encrypt") || msg.action.startsWith("Decrypt")))		//New Version
			{
				try
				{
					var getCert = { action:"GetCertificates", showExpired:msg.showExpired, keyUsageFilter:msg.keyUsageFilter, x509RevocationMode:msg.x509RevocationMode};
					var lstCertJson = await messagePromise(getCert);
					var lstCert = JSON.parse(lstCertJson);
					//Show UI to Display SelCertificate Popup
					msg.certThumbPrint = await showCertSelPopup(lstCert);
				}
				catch(certSelErr)
				{
					delete _tp_promises[msg.nonce];			
					sdReject(new Error(certSelErr));
					return;
				}
			}
			//In case of non Windows OS, we need to invoke UI to get UserPIN for Smartcard
			if(IsNewHostVer && OSName != "Windows" && msg.action.includes("Sign") || msg.action.startsWith("Encrypt") || msg.action.startsWith("Decrypt") || msg.action == "GenCSR" || msg.action == "ImportCER")
			{
				if(!SCPinSet || !hostDetails["SingleSignOnOSXLinux"])		//
				{
					try
					{
						msg["SCPin"] = await showSCPinPopup();
						SCPinSet = true;
					}
					catch(SCPinErr)
					{
						delete _tp_promises[msg.nonce];			
						sdReject(new Error(SCPinErr));
						return;
					}					
				}
			}
			// send message
			window.postMessage(msg, "*");
		});	
	}

	function CheckSiteInLicensedSites(checkSiteLicFeature)
	{
		var SiteFound = false;
		var LicErrorMsg;
		if(LicensedSites != undefined && LicensedSites.length != 0)		//LicensedSites list has items - check those first
		{
			SiteFound = LicensedSites.some( licSite =>
			{
				if(licSite.Website == location.origin.replace('https://','').replace('http://','').replace('www.',''))
				{
					if (licSite.LicStatus != "Active")
						LicErrorMsg = "Signer.Digital Extension Host License is not Active for site: " + location.origin + " - License Status is: <b>" + licSite.LicStatus + "</b>. To fetch fresh License status, delete site from 'Manage Licensed Sites' popup.&nbsp;&nbsp;<button onclick='SignerDigital.ManageLicSites();'>Manage Lic Sites </button>";
					else	//Check for Licensed Feature checkSiteLicFeature
					{
						if(checkSiteLicFeature != "Init" && !licSite.Features.includes(checkSiteLicFeature))
							LicErrorMsg = "Signer.Digital Extension Host Licensed for site only for features: <b>" + licSite.Features + "</b> - Contact site owner for addational features.&nbsp;&nbsp;<button onclick='SignerDigital.ManageLicSites();'>Manage Lic Sites </button>";
						//else Lic is Active for the feature checkSiteLicFeature
					}
					return true;
				}
			});
		}
		return {siteFound : SiteFound, licErrorMsg: LicErrorMsg};
	}
	// async function checkSDEnrolledCA(certIssuer)
	// {
		// var caList = ["AD5HAb+Ij2mmK1hTWpGGdK/xbGLtpQDerMJx35zmSJI=",	//CISPL Signer.Digital DEMO				//add Enrolled CA to this list	
					  // "e6Nrw12cao77xcpOWlMHt8TqsVBWkv10imJ1IxjN2Vw=",	//PantaSign<space> 
					  // "0vViQwEaMomrPzhpI0GjyG532UIjlT2Sb54DQCXt57o="];	//Verasys<space> 
		// const sha256OfIssuer = await SDGetSha256(certIssuer);				
		// if (caList.includes(sha256OfIssuer))
			// return true;
		// else
			// return false;
	// }
	// async function SDGetSha256(message)
	// {
		// // encode as UTF-8
		// const msgBuffer = new TextEncoder().encode(message);				
		// // hash the message
		// const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
		// const bytes = new Uint8Array(hashBuffer);
		// var binary = "";
		// for (var i = 0; i < bytes.byteLength; i++) {
			// binary += String.fromCharCode(bytes[i]);
		// }
		// return window.btoa(binary);
	// };

	//Extension Action Methods
	this.ConsoleLogging = function(Switch = "ON"){
		document.dispatchEvent(new CustomEvent("ConsoleLogging", {detail : Switch}));
	}
	this.startScSession = function(PKCS11Lib, SessionType = "ReadOnly", SingleSignOnOSXLinux = true){
		var msg= { action:"StartScSession", PKCS11Lib:PKCS11Lib, sessionType:SessionType, SingleSignOnOSXLinux:SingleSignOnOSXLinux};
		return messagePromise(msg);	
		hostDetails["SingleSignOnOSXLinux"] = SingleSignOnOSXLinux;
	}
	this.signGstHash = function(hash, certThumbPrint = "", x509RevocationMode = 0){
		var msg= { action:"SignHashCms", hash:hash, certThumbPrint:certThumbPrint, x509RevocationMode:x509RevocationMode};
		return messagePromise(msg, "SignHash");
	}
	this.signITHash = function(hash, PAN, certThumbPrint = "", x509RevocationMode = 0){
		var msg= { action:"ITReturnSign", hash:hash, PAN:PAN, certThumbPrint:certThumbPrint, x509RevocationMode:x509RevocationMode};
		return messagePromise(msg, "SignHash");
	}
	this.signIceGate = function(b64Data, certThumbPrint = "", x509RevocationMode = 0){
		var msg= { action:"IceGateSignJson", b64Data:b64Data, certThumbPrint:certThumbPrint, x509RevocationMode:x509RevocationMode};
		return messagePromise(msg, "SignIceGate");
	}
	this.getSelectedCertificate = async function(certThumbPrint = "", showExpired = false, keyUsageFilter = 128, x509RevocationMode = 0){
		var msg= { action:"GetSelCertFromToken", certThumbPrint:certThumbPrint, showExpired:showExpired, keyUsageFilter:keyUsageFilter, x509RevocationMode:x509RevocationMode};
		return messagePromise(msg);
	}	
	this.signPdfHash = function(hash, certThumbPrint, certAlgorithm, x509RevocationMode = 0){
		var msg= { action:"PdfSignFromToken", hash:hash,certThumbPrint:certThumbPrint,hashAlgorithm:certAlgorithm, x509RevocationMode:x509RevocationMode};		
		return messagePromise(msg, "SignPDF");
	}	
	this.signAuthToken = function(authtoken, certAlgorithm, certThumbPrint = "", showExpired = false, x509RevocationMode = 0){
		var msg= { action:"SignAuthToken", authToken:authtoken, hashAlgorithm:certAlgorithm, certThumbPrint:certThumbPrint, showExpired:showExpired, x509RevocationMode:x509RevocationMode};		
		return messagePromise(msg, "SignHash");
	}
	this.signHash = function(hash, certAlgorithm, certThumbPrint = "", x509RevocationMode = 0){
		var msg= { action:"SignHash", hash:hash, hashAlgorithm:certAlgorithm, certThumbPrint:certThumbPrint, x509RevocationMode:x509RevocationMode};		
		return messagePromise(msg, "SignHash");
	}
	this.signHashCms = function(hash, certAlgorithm, certIncludeOptions = 2, certThumbPrint = "", x509RevocationMode = 0){
		var msg= { action:"SignHashCms", hash:hash, hashAlgorithm:certAlgorithm, certIncludeOptions:certIncludeOptions, certThumbPrint:certThumbPrint, x509RevocationMode:x509RevocationMode};
		return messagePromise(msg, "SignHash");
	}
	this.signHashCAdESBr = function(hash, certAlgorithm, certIncludeOptions = 2, certThumbPrint = "", x509RevocationMode = 0){
		var msg= { action:"SignCAdESBr", hash:hash, hashAlgorithm:certAlgorithm, certIncludeOptions:certIncludeOptions, certThumbPrint:certThumbPrint, x509RevocationMode:x509RevocationMode};	
		return messagePromise(msg, "SignBr");
	}
	this.signHashCAdESEg = function(hash, certAlgorithm, certIncludeOptions = 2, certThumbPrint = "", x509RevocationMode = 0){
		var msg= { action:"SignCAdESEg", hash:hash, hashAlgorithm:certAlgorithm, certIncludeOptions:certIncludeOptions, certThumbPrint:certThumbPrint, x509RevocationMode:x509RevocationMode};	
		return messagePromise(msg, "SignEg");
	}
	this.signXML = function(xmlDoc, xmlSignParms, certThumbPrint, x509RevocationMode = 0){
		var msg= { action:"SignXML", xmlDoc:xmlDoc, xmlSignParms:xmlSignParms, certThumbPrint:certThumbPrint, x509RevocationMode:x509RevocationMode};		
		return messagePromise(msg, "SignXML");
	}
	this.encryptB64Data = function(b64Data, useOAEPPadding, certThumbPrint = "", showExpired = false, keyUsageFilter = 32, x509RevocationMode = 0){
		var msg= { action:"EncryptB64Data", b64Data:b64Data, useOAEPPadding:useOAEPPadding, certThumbPrint:certThumbPrint, showExpired:showExpired, keyUsageFilter:keyUsageFilter, x509RevocationMode:x509RevocationMode};		
		return messagePromise(msg,"EncDec");
	}	
	this.decryptB64Data = function(b64Data, useOAEPPadding, certThumbPrint = "", showExpired = false, keyUsageFilter = 32, x509RevocationMode = 0){
		var msg= { action:"DecryptB64Data", b64Data:b64Data, useOAEPPadding:useOAEPPadding, certThumbPrint:certThumbPrint, showExpired:showExpired, keyUsageFilter:keyUsageFilter, x509RevocationMode:x509RevocationMode};		
		return messagePromise(msg, "EncDec");
	}	
	this.getPCSCReaders = function(onlyConnected = true){
		var msg= { action:"GetPCSCReaders", onlyConnected:onlyConnected};
		return messagePromise(msg);
	}
	this.genCSR = function(certSubject, keyBits = 2048, hashAlgorithm = "SHA256", forceUserPinChangeIfDefault = false, extensions = null){		
		var msg= { action:"GenCSR", certSubject:certSubject, keyBits:keyBits, hashAlgorithm:hashAlgorithm, forceUserPinChangeIfDefault:forceUserPinChangeIfDefault, extensions:extensions};			
		return messagePromise(msg, "CSR");
	}
	this.importCer = function(b64Payload){
		var msg= { action:"ImportCER", b64Data:b64Payload};
		return messagePromise(msg, "CSR");
	}
	this.getSCDetailsAndCerts = function(PKCS11Lib){
		var msg= { action:"GetSCDetailsAndCerts", PKCS11Lib:PKCS11Lib};
		return messagePromise(msg);
	}
	// this.getSelCertAndSCSNUsingPKCS11 = function(PKCS11Lib, hostDomain){
		// var msg= { action:"GetSelCertAndSCSNUsingPKCS11", PKCS11Lib:PKCS11Lib, hostDomain:hostDomain};
		// return messagePromise(msg);
	// }
	// this.unlockSC = function(PKCS11Lib, soPIN, hostDomain){
		// var msg= { action:"UnlockSC", PKCS11Lib:PKCS11Lib, soPIN: soPIN, hostDomain:hostDomain};
		// return messagePromise(msg);
	// }
	this.getHostDetails = function()
	{
		var msg= { action:"GetHostDetails"};
		return messagePromise(msg);
	}
	this.sm = function(msg)
	{
		return messagePromise(msg);
	}
	this.ManageLicSites = showLicSitesPopup;
	this.OSName = GetOS();
	this.OSSupported = (this.OSName == "Windows" || this.OSName == "Linux" || this.OSName == "OSX") ? true : false; 
	this.getPkcsLibBySCName = function(SCName)
        {
            let winHashMap = new Map([
                ["HyperSecu HYP2003", "eps2003csp11v2.dll"],
                ["SafeNet eToken", "eTPKCS11.dll"],
                ["PROXKey Watchdata", "SignatureP11.dll"],
                ["Bit4id tokenME", "bit4ipki.dll"],
                ["Longmai mToken", "CryptoIDA_pkcs11.dll"]
            ]);
            let linuxHashMap = new Map([
                ["HyperSecu HYP2003", "libcastle_v2.so.1.0.0"],
                ["SafeNet eToken", "/usr/lib/libeTPkcs11.so"],
                ["PROXKey Watchdata", "/usr/lib/WatchData/ProxKey/lib/libwdpkcs_SignatureP11.so"],
                ["Longmai mToken", "/opt/CryptoIDATools/bin/lib/libcryptoid_pkcs11.so"]
            ]);
			let osxHashMap = new Map([
                ["HyperSecu HYP2003", "/usr/local/lib/libcastle_v2.1.0.0.dylib"],
				["SafeNet eToken", "/usr/local/lib/libeTPkcs11.dylib"],
                ["PROXKey Watchdata", "/usr/local/lib/wdProxKeyUsbKeyTool/libwdpkcs_Proxkey.dylib"],
                ["Longmai mToken", "/Applications/CryptoIDATools.app/Contents/MacOS/libcryptoid_pkcs11.dylib"]
            ]);			
			var SCNotEnrolledMsg = "Smartcard Not enrolled in Signer.Digital Browser Extension. Can still be used by passing pkcs#11 driver lib absolute path in PKCS11Lib param of method SetSCParm.";
            if (this.OSName == "Windows")
			{
                if (SCName == "Windows Certificate Store")
                    return "Microsoft Enhanced RSA and AES Cryptographic Provider";
                else if (winHashMap.has(SCName))
                    return winHashMap.get(SCName);
				else
					return SCNotEnrolledMsg;
            }
            if (this.OSName == "Linux")
			{
				if (linuxHashMap.has(SCName))
					return linuxHashMap.get(SCName);
				else
					return SCNotEnrolledMsg;
			}
            if (this.OSName == "OSX")
			{
				if (osxHashMap.has(SCName))
					return osxHashMap.get(SCName);
				else
					return SCNotEnrolledMsg;
			}
			else {
                return "OS Not Supported";
            }
        }
	this.getSCNameByReaderName = function(ReaderName)
        {
            let winHashMap = new Map([
                ["HYPERSECU USB TOKEN 0", "HyperSecu HYP2003"],
                ["FT ePass2003Auto 0", "HyperSecu HYP2003"],
				["feitian ePass2003 0", "HyperSecu HYP2003"],
                ["FS USB Token 0", "HyperSecu HYP2003"],
                ["AKS ifdh 0", "SafeNet eToken"],
                ["AKS ifdh 1", "SafeNet eToken"],
                ["SafeNet Token JC 0", "SafeNet eToken"],
                ["SafeNet Token JC 1", "SafeNet eToken"],
                ["Aladdin Token JC 0", "SafeNet eToken"],
                ["Aladdin Token JC 1", "SafeNet eToken"],
                ["Watchdata WDIND USB CCID Key 0", "PROXKey Watchdata"],
                ["Bit4id tokenME FIPS 0", "Bit4id tokenME"],
                ["Longmai mToken CryptoIDA 0", "Longmai mToken"],
				["Gemplus USB SmartCard Reader 0", "Gemalto USB"]
            ]);
            let linuxHashMap = new Map([
                ["Feitian ePass2003", "HyperSecu HYP2003"],
                ["FT ePass2003Auto", "HyperSecu HYP2003"],
                ["SafeNet eToken 5100", "SafeNet eToken"],
                ["Watchdata USB Key", "PROXKey Watchdata"]
            ]);
            if (this.OSName == "Windows")
			{
                if (winHashMap.has(ReaderName))
                    return winHashMap.get(ReaderName);
				else
					return ReaderName;
            }
            if (this.OSName = "Linux")
			{
				if (linuxHashMap.has(ReaderName))
					return linuxHashMap.get(ReaderName);
				else
					return ReaderName;
			}
			else
			{
				return ReaderName;
            }
        }
		function GetOS()
		{
            if (navigator.appVersion.indexOf("Win") != -1) return "Windows";
            else if (navigator.appVersion.indexOf("Mac") != -1) return "OSX";	
            else if (navigator.appVersion.indexOf("Linux") != -1) return "Linux";
            else if (navigator.appVersion.indexOf("X11") != -1) return "UNIX";	
			else return "Unknown OS";
			//userAgentData not yet available in firefox 27Mar23 - return navigator.userAgentData.platform;
		}
		
		//=============== Allowed / Licensed Sites  ==========================
		// Function to check Licensed site and show LicensedSites Popup 
		async function showLicSitesPopup(openedByCode = false, checkSiteLicFeature) {
			return new Promise(async function (LicSiteResolve, LicSiteReject) {
				// DOM Elements
				const currentDomainLink = document.getElementById("currentDomainLink");
				const LicSitesCloseBtn = document.getElementById("LicSitesCloseBtn");
				const LicSitesPopupModal = document.getElementById("LicSitesPopupModal");
				const tableBody = document.getElementById("licenseSitesTableBody");
				const denyBtn = document.getElementById("denyBtn");
				const alwaysallowBtn = document.getElementById("alwaysallowBtn");
				const sdLicSitesErrMsg = document.getElementById("SDLicSitesErrMsg");

				if(currentDomainLink == undefined)		//If page does not have injected elements, prevent error
				{
					LicSiteReject("Signer.Digital UI not preperly loaded in page.");		
					return;					
				}
				
				//Get host Version if not set
				if(IsNewHostVer == undefined && openedByCode == false)		
				{
					hostDetailsJson = await messagePromise({ action:""});		//Dummy call to messagePromise to get IsNewHostVer variable set
				}

				if(!IsNewHostVer)
				{
					LicSiteReject("This feature is supported by Signer.Digital Extension Host Ver 5 or above. Please install new version.");		
					return;					
				}

				if(sdLicSitesErrMsg != null) sdLicSitesErrMsg.textContent = "";

				//Load LicensedSites if not yet loaded
				if(LicensedSites == undefined)
				{
					licSitesJson = await messagePromise({ action:"GetOrAllowLicensedSites"}) ;
					LicensedSites = JSON.parse(licSitesJson);
				}				

				// Update current domain link
				//currentDomainLink.href = location.origin;
				currentDomainLink.textContent = location.origin;
				populateLicSiteTable(); // Populate the table with licensed sites
				LicSitesPopupModal.style.display = "flex"; // Show the modal


				//"Denay" button clicked
				denyBtn.addEventListener("click", () => {
					LicSitesPopupModal.style.display = "none";
					if(openedByCode)
						LicSiteReject("SDHost Error: User denied site access to Signer.Digital Browser Extension.");
					else
						LicSiteResolve();		//In case user Manually opened LicsitesPopup
					return;
				});

				//"Always Allow" button clicked
				alwaysallowBtn.addEventListener("click", async () => 
				{
					var forLicSite = location.origin.replace('https://','').replace('http://','').replace('www.','');

					if(!openedByCode)
					{
						var errSitePresent;
						//In case user has laterally (Manually) opened LicSitesPopup and then clicked AlwaysAllow Btn
						//Check if site is already present in LicensedSites array - 
						LicensedSites.forEach( licSite =>
						{
							if(licSite.Website == forLicSite)
								errSitePresent = "Site: " + forLicSite + " already present in LicensedSites, if you want to retry License check from server, first delete site and then retry"; 
		
						});
						if (errSitePresent != undefined)		//return statement inside forEach statement does not return function in javascript, hence this!
						{
							document.getElementById("SDLicSitesErrMsg").textContent = errSitePresent;
							LicSiteResolve();
							return;
						}
					}

					//Send msg to SDHost to Do the check
					//forLicSite param is passed, thus below action would return lic for only requested site, append to list
					var licSitesJsonForSingleSite = await messagePromise({ action:"GetOrAllowLicensedSites", forLicSite:forLicSite});
					queriedLicSiteObj = JSON.parse(licSitesJsonForSingleSite);
					if(queriedLicSiteObj.length > 0)
						LicensedSites.push(queriedLicSiteObj[0]);		//Add new SiteLicObj to list

					var chkSitLicResult;
					if(checkSiteLicFeature != undefined)
						//Check Site License in the list just refreshed from the server.
						chkSitLicResult = CheckSiteInLicensedSites(checkSiteLicFeature);

					LicSitesPopupModal.style.display = "none";
					if(chkSitLicResult?.licErrorMsg != undefined)
					{
						LicSiteReject("SDHost Error: " + chkSitLicResult.licErrorMsg);
						return;
					}
					else
					{
						LicSiteResolve();	//Allow flow to proceed
						return;
					}
				});
				
				//Close modal when "Close" button is clicked
				LicSitesCloseBtn.addEventListener("click", () => {
					LicSitesPopupModal.style.display = "none";
					if(openedByCode)
					{
						LicSiteReject("SDHost Error: License check cancelled by user.");
						return;
					}
					else
					{
						LicSiteResolve();		//In case user Manually opened LicsitesPopup
						return;
					}
				});
			});
		}

	// Function to populate the table dynamically
	function populateLicSiteTable() {
		const tableBody = document.getElementById('licenseSitesTableBody');
		//Clear existing rows
		while (tableBody!= null && tableBody.hasChildNodes()) {
			tableBody.removeChild(tableBody.lastChild);
		}
		if (LicensedSites == undefined || LicensedSites.length == 0)
			return;

		LicensedSites.forEach((site, index) => {
			const row = document.createElement('tr');

			// Website column
			const websiteCell = document.createElement('td');
			websiteCell.textContent = site.Website;
			websiteCell.className = 'SignerDigitalExtLicSitesTd';
			row.appendChild(websiteCell);

			// License Status column
			const statusCell = document.createElement('td');
			statusCell.textContent = site.LicStatus;
			statusCell.className = 'SignerDigitalExtLicSitesTd';
			row.appendChild(statusCell);

			// Features column
			const featuresCell = document.createElement('td');
			featuresCell.textContent = site.Features;
			featuresCell.className = 'SignerDigitalExtLicSitesTd';
			row.appendChild(featuresCell);
			//Delete Button Column
			const deleteCell = document.createElement('td');
			const deleteIcon = document.createElement('img');
			deleteIcon.src = document.getElementById("trash_icon_src").src; // Path to your delete icon image
			deleteIcon.alt = 'Delete';
			deleteIcon.style.cursor = 'pointer'; // Make the icon clickable
			deleteIcon.style.width = '20px';
			deleteIcon.onclick = () => handleLicSiteDelete(index); // Attach the delete event handler
			deleteCell.appendChild(deleteIcon);
			deleteCell.className = 'SignerDigitalExtLicSitesTdd';
			row.appendChild(deleteCell);

			tableBody.appendChild(row);
		});
	}
	
	//Event handler for Delete Item from LicSites table (Button at each row)
	async function handleLicSiteDelete(index) {
		try{
			LicSiteItemToDel = LicensedSites[index];
			await messagePromise({ action:"DeleteLicensedSite", forLicSite: LicSiteItemToDel.Website });			
			LicensedSites.splice(index, 1); // Remove the item from the array
			populateLicSiteTable(); // Refresh the table
		}
		catch (err)
		{
			document.getElementById("SDLicSitesErrMsg").textContent = err;
		}
	}
	//=============== Certificate Selection Popup  ==========================
	let selectedCertThumbprint = null;			
	// Function to show certificatelist selection popup and populate the certificates 
	async function showCertSelPopup(lstCert) {
		return new Promise(async function (SelCertResolve, SelCertReject) {
			const SelCertPopupModal = document.getElementById("SelCertPopupModal");
			const SDCertListContainer = document.getElementById("SDCertListContainer");
			let selectedCertThumbprint = null;
			
			// Populate certificate list
			SDCertListContainer.innerHTML = lstCert
				.map((cert) => {
					const expiryDate = new Date(cert.CertExp);
					const isExpired = expiryDate < new Date();
					return `<div class="SignerDigitalExtCertItem" data-thumbprint="${cert.CertThumbprint}">
						<strong style="color: blue;">${cert.CertName}</strong>
						(<span style="color: blue;">${cert.CertEMail}</span>)<br>
						Organization: ${cert.CertOrg}<br>
						Expiry: <span class="${isExpired ? "expired" : ""}">${expiryDate.toLocaleString()}</span>
					</div>`;
				}).join("");

				document.querySelectorAll(".SignerDigitalExtCertItem").forEach((item) => 
				{
					item.addEventListener("click", function () 
					{
						document.querySelectorAll(".SignerDigitalExtCertItem").forEach((i) =>
							i.classList.remove("selected")
						);
						this.classList.add("selected");
						selectedCertThumbprint = this.getAttribute("data-thumbprint");
					});

					item.addEventListener("dblclick", function () 
					{
						if (selectedCertThumbprint) {
						SelCertResolve(selectedCertThumbprint);
						closeModal();
					}
					else 
						alert("No certificate selected. Please select Certificate or click Cancel button.");
					});
				});

			// Show the modal
			SelCertPopupModal.style.display = "block";

			// Handle OK button click
			document.getElementById("SelCertOkBtn").onclick = () => {
				if(lstCert.length ==1)
					selectedCertThumbprint = lstCert[0].CertThumbprint;
				if (selectedCertThumbprint) {
					SelCertResolve(selectedCertThumbprint);
					closeModal();
				} else {
					alert("No Certificate selected. Please select Certificate or click Cancel button.");
				}
			};

			// Handle Close button click
			document.getElementById("SelCertCloseBtn").onclick = () => {
				closeModal();
				SelCertReject("Certificate Selection Cancelled by User.");
			};
			// Handle Cancel button click
			document.getElementById("SelCertCancelBtn").onclick = () => {
				closeModal();
				SelCertReject("Certificate Selection Cancelled by User.");
			};

			// Handle Enter key
			document.addEventListener("keydown", handleKeyPress);

			function handleKeyPress(event) {
				if (event.key === "Enter") {
					if (selectedCertThumbprint) {
						SelCertResolve(selectedCertThumbprint);
						closeModal();
					} else 
						alert("No Certificate selected. Please select Certificate or click Cancel button.");
					
				}
			}

			// Close the modal and clean up
			function closeModal() {
				SelCertPopupModal.style.display = "none";
				SDCertListContainer.innerHTML = ""; // Clear certificates
				selectedCertThumbprint = null; // Reset selection
				document.removeEventListener("keydown", handleKeyPress); // Remove keypress listener
			}
				
		});
	}
	//=============== Smartcard or USB Token Pin Entry Dialog  ==========================
	// Function to show Smartcard or USB Token Pin Entry popup 
	async function showSCPinPopup() {
		return new Promise(async function (SCPinResolve, SCPinReject) {
			const SdExtSCPinPopupModal = document.getElementById("SdExtSCPinPopupModal");			
			const SdExtUserPin = document.getElementById("SdExtUserPin");

			// Show the modal
			SdExtUserPin.value = "";
			SdExtSCPinPopupModal.style.display = "block";
			SdExtUserPin.focus;
			
			// Handle OK button click
			document.getElementById("SdScPinOkBtn").onclick = () => 
			{
				var SdSCPin = SdExtUserPin.value;
				if (SdSCPin != "") {
						SCPinResolve(SdSCPin);
						closeModal();
					} else 
						alert("Please enter SmartCard or USB Token PIN.");
					
				SCPinResolve(SdSCPin);
			};

			// Handle Cancel button click
			document.getElementById("SdSCPinCancelBtn").onclick = () => {
				closeModal();
				SCPinReject("Smartcard PIN Verification Cancelled by User.");
			};
			// Handle Enter key
			document.addEventListener("keydown", handleKeyPress);
			function handleKeyPress(event) {
				if (event.key === "Enter") {
					var SdSCPin = document.getElementById("SdExtUserPin").value;
					if (SdSCPin != "") {
						SCPinResolve(SdSCPin);
						closeModal();
					} else 
						alert("Please enter SmartCard or USB Token PIN.");
					
				}
			}
			// Close the modal and clean up
			function closeModal() {
				SdExtSCPinPopupModal.style.display = "none";
				document.removeEventListener("keydown", handleKeyPress); // Remove keypress listener
			}
		});
	}
}//End of SDCrypto class