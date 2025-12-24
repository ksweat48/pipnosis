import React, { useState, useEffect, useRef } from 'react';
import { Smartphone, Download, CheckCircle, Zap, Wifi, Bell, Share2, AlertCircle, ArrowDown, Plus, Menu } from 'lucide-react';

export default function GetAppPage() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [platform, setPlatform] = useState<'ios' | 'android' | 'desktop'>('desktop');
  const [isIosSafari, setIsIosSafari] = useState(false);
  const [showInstructionsHighlight, setShowInstructionsHighlight] = useState(false);
  const instructionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const userAgent = navigator.userAgent.toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(userAgent);
    const isSafari = /safari/.test(userAgent) && !/chrome|crios|fxios|edgios/.test(userAgent);

    if (isIos) {
      setPlatform('ios');
      setIsIosSafari(isSafari);
    } else if (/android/.test(userAgent)) {
      setPlatform('android');
    } else {
      setPlatform('desktop');
    }

    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === 'accepted') {
      setIsInstalled(true);
    }

    setDeferredPrompt(null);
  };

  const handleMainCTAClick = async () => {
    if (deferredPrompt) {
      await handleInstallClick();
    } else {
      setShowInstructionsHighlight(true);
      instructionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => setShowInstructionsHighlight(false), 3000);
    }
  };

  return (
    <div className="fixed inset-0 overflow-y-auto bg-gradient-to-b from-gray-900 via-gray-800 to-gray-900 text-white">
      <div className="min-h-screen pt-20 pb-12 px-4">
        <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-6">
            <div className="p-4 bg-gradient-to-br from-emerald-500 to-green-600 rounded-3xl shadow-2xl">
              <Smartphone size={48} className="text-white" />
            </div>
          </div>

          <h1 className="text-4xl md:text-5xl font-bold mb-4 bg-gradient-to-r from-emerald-400 to-green-400 bg-clip-text text-transparent">
            Get the Pipnosis App
          </h1>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">
            Install Pipnosis as a Progressive Web App for the best trading experience
          </p>
        </div>

        {!isInstalled && (
          <div className="mb-8">
            <button
              onClick={handleMainCTAClick}
              className="w-full max-w-md mx-auto bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white px-8 py-5 rounded-2xl font-bold text-xl shadow-2xl transition-all transform hover:scale-105 flex items-center justify-center gap-3 border-2 border-emerald-400"
            >
              {platform === 'ios' && <Plus size={32} />}
              {platform === 'android' && <Download size={32} />}
              {platform === 'desktop' && <Download size={32} />}
              <span>
                {platform === 'ios' && 'Add to Home Screen'}
                {platform === 'android' && 'Download for Android'}
                {platform === 'desktop' && 'Install App'}
              </span>
            </button>
            {!deferredPrompt && (
              <p className="text-center text-gray-400 text-sm mt-3">
                {platform === 'ios'
                  ? 'Tap to see installation instructions'
                  : 'Tap to see how to install manually'}
              </p>
            )}
          </div>
        )}

        {isInstalled ? (
          <div className="bg-green-900/30 border-2 border-green-500 rounded-xl p-8 text-center mb-8">
            <CheckCircle size={64} className="text-green-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-green-400 mb-2">App Already Installed!</h2>
            <p className="text-gray-300">
              You're using the Pipnosis app. Enjoy your enhanced trading experience!
            </p>
          </div>
        ) : null}

        {platform === 'ios' && !isIosSafari && !isInstalled && (
          <div className="bg-orange-900/30 border-2 border-orange-500 rounded-xl p-6 mb-8 animate-pulse">
            <div className="flex items-start gap-4">
              <AlertCircle className="text-orange-400 flex-shrink-0 mt-1" size={32} />
              <div>
                <h3 className="text-xl font-bold text-orange-400 mb-2">Please Open in Safari</h3>
                <p className="text-gray-300 mb-3">
                  iPhone apps can only be installed from Safari browser. Please copy this URL and open it in Safari:
                </p>
                <div className="bg-gray-800 rounded-lg p-3 font-mono text-sm text-emerald-400 break-all">
                  {window.location.href}
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.href);
                    alert('URL copied! Now paste it in Safari browser.');
                  }}
                  className="mt-3 bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg font-semibold transition-colors"
                >
                  Copy URL
                </button>
              </div>
            </div>
          </div>
        )}

        {platform === 'ios' && isIosSafari && !isInstalled && (
          <div className="bg-gradient-to-r from-emerald-600 to-green-600 rounded-xl p-6 mb-8 shadow-2xl border-2 border-emerald-400">
            <div className="flex items-start gap-4">
              <div className="bg-white rounded-full p-3 flex-shrink-0">
                <Share2 className="text-emerald-600" size={32} />
              </div>
              <div className="flex-1">
                <h2 className="text-2xl font-bold mb-2 text-white">Ready to Install on iPhone</h2>
                <p className="text-emerald-50 mb-3 text-lg">
                  Tap the Share button below and select "Add to Home Screen"
                </p>
                <div className="flex items-center gap-2 text-emerald-100 font-semibold">
                  <ArrowDown className="animate-bounce" size={24} />
                  <span>Look for the share icon at the bottom of your screen</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <Zap className="text-emerald-400 mb-4" size={32} />
            <h3 className="text-lg font-semibold mb-2">Lightning Fast</h3>
            <p className="text-gray-400 text-sm">
              Native app performance with instant loading and smooth animations
            </p>
          </div>

          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <Wifi className="text-blue-400 mb-4" size={32} />
            <h3 className="text-lg font-semibold mb-2">Works Offline</h3>
            <p className="text-gray-400 text-sm">
              Continue viewing your data and trades even without internet connection
            </p>
          </div>

          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <Bell className="text-purple-400 mb-4" size={32} />
            <h3 className="text-lg font-semibold mb-2">Push Notifications</h3>
            <p className="text-gray-400 text-sm">
              Get instant alerts about your trades, goals, and market opportunities
            </p>
          </div>
        </div>

        {deferredPrompt && !isInstalled && (
          <div className="bg-gradient-to-r from-emerald-600 to-green-600 rounded-xl p-8 text-center mb-8 shadow-2xl">
            <h2 className="text-2xl font-bold mb-4">Ready to Install</h2>
            <p className="text-gray-100 mb-6">
              Click the button below to add Pipnosis to your home screen
            </p>
            <button
              onClick={handleInstallClick}
              className="bg-white text-emerald-600 px-8 py-3 rounded-lg font-semibold text-lg hover:bg-gray-100 transition-colors inline-flex items-center gap-2"
            >
              <Download size={24} />
              Install App Now
            </button>
          </div>
        )}

        <div className="space-y-8" ref={instructionsRef}>
          {platform === 'ios' && (
            <div className={`bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-8 border-2 shadow-2xl transition-all duration-500 ${
              showInstructionsHighlight
                ? 'border-emerald-400 ring-4 ring-emerald-500/50 animate-pulse'
                : 'border-emerald-500'
            }`}>
              <div className="flex items-center gap-3 mb-8">
                <div className="bg-emerald-600 p-3 rounded-2xl">
                  <Smartphone className="text-white" size={36} />
                </div>
                <div>
                  <h2 className="text-3xl font-bold text-emerald-400">iPhone/iPad Installation</h2>
                  <p className="text-gray-400 text-sm">Follow these 4 simple steps</p>
                </div>
              </div>

              <ol className="space-y-6">
                <li className="flex gap-4 bg-gray-900/50 rounded-xl p-5 border border-emerald-600/30 hover:border-emerald-500/50 transition-colors">
                  <span className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full flex items-center justify-center text-lg font-bold shadow-lg">1</span>
                  <div className="flex-1">
                    <p className="font-bold text-lg mb-2 text-white">Open in Safari Browser</p>
                    <p className="text-gray-300 leading-relaxed">Make sure you're using Safari browser, not Chrome or other browsers. iOS apps can only be installed from Safari.</p>
                  </div>
                </li>
                <li className="flex gap-4 bg-gray-900/50 rounded-xl p-5 border border-emerald-600/30 hover:border-emerald-500/50 transition-colors">
                  <span className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full flex items-center justify-center text-lg font-bold shadow-lg">2</span>
                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <p className="font-bold text-lg text-white">Tap the Share Button</p>
                      <Share2 className="text-emerald-400 flex-shrink-0" size={28} />
                    </div>
                    <p className="text-gray-300 leading-relaxed">Look for the share icon at the bottom center of your screen (square with an arrow pointing up).</p>
                  </div>
                </li>
                <li className="flex gap-4 bg-gray-900/50 rounded-xl p-5 border border-emerald-600/30 hover:border-emerald-500/50 transition-colors">
                  <span className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full flex items-center justify-center text-lg font-bold shadow-lg">3</span>
                  <div className="flex-1">
                    <p className="font-bold text-lg mb-2 text-white">Select "Add to Home Screen"</p>
                    <p className="text-gray-300 leading-relaxed">Scroll down in the share menu and tap the "Add to Home Screen" option. You'll see the Pipnosis icon.</p>
                  </div>
                </li>
                <li className="flex gap-4 bg-gray-900/50 rounded-xl p-5 border border-emerald-600/30 hover:border-emerald-500/50 transition-colors">
                  <span className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full flex items-center justify-center text-lg font-bold shadow-lg">4</span>
                  <div className="flex-1">
                    <p className="font-bold text-lg mb-2 text-white">Tap "Add" to Confirm</p>
                    <p className="text-gray-300 leading-relaxed">Tap the "Add" button in the top right corner. The Pipnosis app will appear on your home screen!</p>
                  </div>
                </li>
              </ol>

              <div className="mt-8 bg-emerald-900/30 border border-emerald-500/50 rounded-xl p-5">
                <div className="flex items-start gap-3">
                  <CheckCircle className="text-emerald-400 flex-shrink-0 mt-1" size={24} />
                  <div>
                    <p className="font-semibold text-emerald-400 mb-1">Once Installed</p>
                    <p className="text-gray-300 text-sm">The Pipnosis app will appear on your home screen with a green icon. Tap it to launch the full app experience!</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {platform === 'android' && (
            <div className={`bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-8 border-2 shadow-2xl transition-all duration-500 ${
              showInstructionsHighlight
                ? 'border-emerald-400 ring-4 ring-emerald-500/50 animate-pulse'
                : 'border-emerald-500'
            }`}>
              <div className="flex items-center gap-3 mb-8">
                <div className="bg-emerald-600 p-3 rounded-2xl">
                  <Smartphone className="text-white" size={36} />
                </div>
                <div>
                  <h2 className="text-3xl font-bold text-emerald-400">Android Installation</h2>
                  <p className="text-gray-400 text-sm">
                    {deferredPrompt ? 'One-click install available!' : 'Follow these 3 simple steps'}
                  </p>
                </div>
              </div>

              {!deferredPrompt && (
                <>
                  <div className="bg-blue-900/30 border border-blue-500/50 rounded-xl p-5 mb-6">
                    <div className="flex items-start gap-3">
                      <Menu className="text-blue-400 flex-shrink-0 mt-1" size={24} />
                      <div>
                        <p className="font-semibold text-blue-400 mb-1">Manual Installation Required</p>
                        <p className="text-gray-300 text-sm">
                          The automatic install prompt isn't available. Follow the steps below to install manually.
                        </p>
                      </div>
                    </div>
                  </div>

                  <ol className="space-y-6">
                    <li className="flex gap-4 bg-gray-900/50 rounded-xl p-5 border border-emerald-600/30 hover:border-emerald-500/50 transition-colors">
                      <span className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full flex items-center justify-center text-lg font-bold shadow-lg">1</span>
                      <div className="flex-1">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <p className="font-bold text-lg text-white">Open Chrome Menu</p>
                          <Menu className="text-emerald-400 flex-shrink-0" size={28} />
                        </div>
                        <p className="text-gray-300 leading-relaxed">Tap the three dots (⋮) in the top right corner of your Chrome browser.</p>
                      </div>
                    </li>
                    <li className="flex gap-4 bg-gray-900/50 rounded-xl p-5 border border-emerald-600/30 hover:border-emerald-500/50 transition-colors">
                      <span className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full flex items-center justify-center text-lg font-bold shadow-lg">2</span>
                      <div className="flex-1">
                        <p className="font-bold text-lg mb-2 text-white">Select "Add to Home screen"</p>
                        <p className="text-gray-300 leading-relaxed">Look for "Add to Home screen" or "Install app" option in the menu and tap it.</p>
                      </div>
                    </li>
                    <li className="flex gap-4 bg-gray-900/50 rounded-xl p-5 border border-emerald-600/30 hover:border-emerald-500/50 transition-colors">
                      <span className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full flex items-center justify-center text-lg font-bold shadow-lg">3</span>
                      <div className="flex-1">
                        <p className="font-bold text-lg mb-2 text-white">Confirm Installation</p>
                        <p className="text-gray-300 leading-relaxed">Tap "Add" or "Install" to complete. The Pipnosis app will appear on your home screen!</p>
                      </div>
                    </li>
                  </ol>

                  <div className="mt-8 bg-emerald-900/30 border border-emerald-500/50 rounded-xl p-5">
                    <div className="flex items-start gap-3">
                      <CheckCircle className="text-emerald-400 flex-shrink-0 mt-1" size={24} />
                      <div>
                        <p className="font-semibold text-emerald-400 mb-1">Once Installed</p>
                        <p className="text-gray-300 text-sm">The Pipnosis app will appear on your home screen with a green icon. Tap it to launch the full app experience!</p>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="mt-12 bg-gray-800/50 border border-gray-700 rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-3">Why Install the App?</h3>
          <ul className="space-y-2 text-gray-400">
            <li className="flex items-start gap-2">
              <CheckCircle size={20} className="text-emerald-400 flex-shrink-0 mt-0.5" />
              <span>Full-screen trading experience without browser clutter</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle size={20} className="text-emerald-400 flex-shrink-0 mt-0.5" />
              <span>Faster load times and improved performance</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle size={20} className="text-emerald-400 flex-shrink-0 mt-0.5" />
              <span>Quick access from your home screen or desktop</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle size={20} className="text-emerald-400 flex-shrink-0 mt-0.5" />
              <span>Works offline for viewing your trade history and data</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle size={20} className="text-emerald-400 flex-shrink-0 mt-0.5" />
              <span>Get push notifications for important trade alerts</span>
            </li>
          </ul>
        </div>
        </div>
      </div>
    </div>
  );
}
