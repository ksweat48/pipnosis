import React from 'react';
import { X, AlertTriangle, Shield, Scale, FileText, Users, Globe, Lock } from 'lucide-react';

interface DisclaimerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DisclaimerModal: React.FC<DisclaimerModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-4xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <div className="flex items-center space-x-3">
            <AlertTriangle className="h-6 w-6 text-amber-400" />
            <h2 className="text-xl font-semibold text-white">Pipnosis Disclaimer</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 max-h-[calc(90vh-120px)]">
          {/* Introduction */}
          <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <p className="text-amber-200 leading-relaxed">
              Pipnosis is an experimental AI-powered trading assistant that executes trades based on user-defined goals and market data. 
              While Pipnosis utilizes sophisticated analysis and decision-making models, no trading outcome is guaranteed. 
              All users acknowledge that trading financial instruments involves inherent risks, including the loss of capital.
            </p>
          </div>

          {/* Important Notices */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white mb-4">Important Notices:</h3>

            {/* Not Financial Advice */}
            <div className="border-l-4 border-blue-500 bg-blue-500/5 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <FileText className="h-5 w-5 text-blue-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-blue-300 font-semibold mb-2">Not Financial Advice:</h4>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    Pipnosis does not provide financial, investment, tax, or legal advice. The platform operates as an 
                    automated execution tool based on user input and publicly available market data.
                  </p>
                </div>
              </div>
            </div>

            {/* Performance Not Guaranteed */}
            <div className="border-l-4 border-yellow-500 bg-yellow-500/5 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <AlertTriangle className="h-5 w-5 text-yellow-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-yellow-300 font-semibold mb-2">Performance Is Not Guaranteed:</h4>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    Past performance, AI accuracy, or backtested results are not indicative of future results. 
                    Pipnosis will prioritize capital protection, but users can still experience partial or full losses.
                  </p>
                </div>
              </div>
            </div>

            {/* User Responsibility */}
            <div className="border-l-4 border-purple-500 bg-purple-500/5 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <Users className="h-5 w-5 text-purple-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-purple-300 font-semibold mb-2">User Responsibility:</h4>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    While Pipnosis is designed to limit risk and act intelligently, users are ultimately responsible for 
                    enabling trades, connecting accounts, and understanding their personal risk tolerance.
                  </p>
                </div>
              </div>
            </div>

            {/* Market Risk Disclosure */}
            <div className="border-l-4 border-red-500 bg-red-500/5 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <AlertTriangle className="h-5 w-5 text-red-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-red-300 font-semibold mb-2">Market Risk Disclosure:</h4>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    Volatility, slippage, execution delay, and data discrepancies can impact trade outcomes. 
                    Pipnosis will attempt to mitigate such risks but cannot eliminate them entirely.
                  </p>
                </div>
              </div>
            </div>

            {/* AI Decision Autonomy */}
            <div className="border-l-4 border-emerald-500 bg-emerald-500/5 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <Shield className="h-5 w-5 text-emerald-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-emerald-300 font-semibold mb-2">AI Decision Autonomy:</h4>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    Users grant Pipnosis AI discretionary decision-making authority within the selected risk mode. 
                    However, the system may override certain trades to preserve account safety or limit exposure.
                  </p>
                </div>
              </div>
            </div>

            {/* No Liability */}
            <div className="border-l-4 border-slate-500 bg-slate-500/5 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <Scale className="h-5 w-5 text-slate-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-slate-300 font-semibold mb-2">No Liability:</h4>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    The developers, operators, and affiliates of Pipnosis are not liable for any financial losses, 
                    damages, or missed opportunities resulting from the use of this platform.
                  </p>
                </div>
              </div>
            </div>

            {/* Regulatory Compliance */}
            <div className="border-l-4 border-orange-500 bg-orange-500/5 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <Globe className="h-5 w-5 text-orange-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-orange-300 font-semibold mb-2">Regulatory Compliance:</h4>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    Users must ensure their trading activity complies with local laws, including account registration, 
                    tax obligations, and platform eligibility. Pipnosis does not guarantee regulatory approval in any jurisdiction.
                  </p>
                </div>
              </div>
            </div>

            {/* Account Access */}
            <div className="border-l-4 border-cyan-500 bg-cyan-500/5 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <Lock className="h-5 w-5 text-cyan-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-cyan-300 font-semibold mb-2">Account Access:</h4>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    By connecting your broker or MT5 account, you acknowledge and authorize Pipnosis to analyze, 
                    place, and manage trades based on its internal logic and your selected parameters.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Risk Warning */}
          <div className="p-4 bg-red-500/10 border-2 border-red-500/30 rounded-lg">
            <div className="flex items-start space-x-3">
              <AlertTriangle className="h-6 w-6 text-red-400 mt-0.5 flex-shrink-0" />
              <div>
                <h4 className="text-red-300 font-semibold mb-2">⚠️ High Risk Warning</h4>
                <p className="text-red-200 text-sm leading-relaxed">
                  Trading foreign exchange (forex) and contracts for difference (CFDs) carries a high level of risk and may not be suitable for all investors. 
                  You should carefully consider your investment objectives, level of experience, and risk appetite before using Pipnosis. 
                  <strong className="text-red-100"> You could lose some or all of your initial investment.</strong>
                </p>
              </div>
            </div>
          </div>

          {/* Acknowledgment */}
          <div className="p-4 bg-slate-900 border border-slate-600 rounded-lg">
            <h4 className="text-white font-semibold mb-2">By using Pipnosis, you acknowledge that:</h4>
            <ul className="text-slate-300 text-sm space-y-1 list-disc list-inside">
              <li>You have read and understood this disclaimer</li>
              <li>You accept all risks associated with automated trading</li>
              <li>You are solely responsible for your trading decisions and outcomes</li>
              <li>You will not hold Pipnosis liable for any losses or damages</li>
              <li>You understand that AI trading involves experimental technology</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-slate-700 bg-slate-800">
          <div className="text-sm text-slate-400">
            Last updated: {new Date().toLocaleDateString()}
          </div>
          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className="px-6 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors"
            >
              I Understand
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};