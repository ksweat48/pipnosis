import React, { useState, useEffect } from 'react';
import { Smartphone, Monitor, Download, CheckCircle, Zap, Wifi, Bell } from 'lucide-react';

export default function GetAppPage() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [platform, setPlatform] = useState<'ios' | 'android' | 'desktop'>('desktop');

  useEffect(() => {
    const userAgent = navigator.userAgent.toLowerCase();

    if (/iphone|ipad|ipod/.test(userAgent)) {
      setPlatform('ios');
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-gray-900 text-white pt-20 pb-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
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

        {isInstalled ? (
          <div className="bg-green-900/30 border-2 border-green-500 rounded-xl p-8 text-center mb-8">
            <CheckCircle size={64} className="text-green-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-green-400 mb-2">App Already Installed!</h2>
            <p className="text-gray-300">
              You're using the Pipnosis app. Enjoy your enhanced trading experience!
            </p>
          </div>
        ) : null}

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

        <div className="space-y-8">
          {platform === 'ios' && (
            <div className="bg-gray-800 rounded-xl p-8 border border-gray-700">
              <div className="flex items-center gap-3 mb-6">
                <Smartphone className="text-emerald-400" size={32} />
                <h2 className="text-2xl font-bold">Install on iPhone/iPad</h2>
              </div>

              <ol className="space-y-4 text-gray-300">
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-8 h-8 bg-emerald-600 rounded-full flex items-center justify-center text-sm font-bold">1</span>
                  <div>
                    <p className="font-semibold mb-1">Open in Safari</p>
                    <p className="text-sm text-gray-400">Make sure you're using Safari browser (not Chrome or other browsers)</p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-8 h-8 bg-emerald-600 rounded-full flex items-center justify-center text-sm font-bold">2</span>
                  <div>
                    <p className="font-semibold mb-1">Tap the Share button</p>
                    <p className="text-sm text-gray-400">Look for the share icon at the bottom of the screen (square with arrow pointing up)</p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-8 h-8 bg-emerald-600 rounded-full flex items-center justify-center text-sm font-bold">3</span>
                  <div>
                    <p className="font-semibold mb-1">Select "Add to Home Screen"</p>
                    <p className="text-sm text-gray-400">Scroll down in the share menu and tap "Add to Home Screen"</p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-8 h-8 bg-emerald-600 rounded-full flex items-center justify-center text-sm font-bold">4</span>
                  <div>
                    <p className="font-semibold mb-1">Tap "Add"</p>
                    <p className="text-sm text-gray-400">Confirm by tapping "Add" in the top right corner</p>
                  </div>
                </li>
              </ol>
            </div>
          )}

          {platform === 'android' && !deferredPrompt && (
            <div className="bg-gray-800 rounded-xl p-8 border border-gray-700">
              <div className="flex items-center gap-3 mb-6">
                <Smartphone className="text-emerald-400" size={32} />
                <h2 className="text-2xl font-bold">Install on Android</h2>
              </div>

              <ol className="space-y-4 text-gray-300">
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-8 h-8 bg-emerald-600 rounded-full flex items-center justify-center text-sm font-bold">1</span>
                  <div>
                    <p className="font-semibold mb-1">Open Chrome menu</p>
                    <p className="text-sm text-gray-400">Tap the three dots in the top right corner</p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-8 h-8 bg-emerald-600 rounded-full flex items-center justify-center text-sm font-bold">2</span>
                  <div>
                    <p className="font-semibold mb-1">Tap "Add to Home screen"</p>
                    <p className="text-sm text-gray-400">Or look for "Install app" option in the menu</p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-8 h-8 bg-emerald-600 rounded-full flex items-center justify-center text-sm font-bold">3</span>
                  <div>
                    <p className="font-semibold mb-1">Confirm installation</p>
                    <p className="text-sm text-gray-400">Tap "Add" or "Install" to complete</p>
                  </div>
                </li>
              </ol>
            </div>
          )}

          {platform === 'desktop' && !deferredPrompt && (
            <div className="bg-gray-800 rounded-xl p-8 border border-gray-700">
              <div className="flex items-center gap-3 mb-6">
                <Monitor className="text-emerald-400" size={32} />
                <h2 className="text-2xl font-bold">Install on Desktop</h2>
              </div>

              <ol className="space-y-4 text-gray-300">
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-8 h-8 bg-emerald-600 rounded-full flex items-center justify-center text-sm font-bold">1</span>
                  <div>
                    <p className="font-semibold mb-1">Look for the install icon</p>
                    <p className="text-sm text-gray-400">Chrome: Click the install icon in the address bar (computer with down arrow)</p>
                    <p className="text-sm text-gray-400">Edge: Click the app icon in the address bar or menu</p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-8 h-8 bg-emerald-600 rounded-full flex items-center justify-center text-sm font-bold">2</span>
                  <div>
                    <p className="font-semibold mb-1">Click "Install"</p>
                    <p className="text-sm text-gray-400">Confirm the installation when prompted</p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-8 h-8 bg-emerald-600 rounded-full flex items-center justify-center text-sm font-bold">3</span>
                  <div>
                    <p className="font-semibold mb-1">Launch from your desktop</p>
                    <p className="text-sm text-gray-400">Pipnosis will now appear as a standalone app on your computer</p>
                  </div>
                </li>
              </ol>
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
  );
}
