import React from 'react';
import { X } from 'lucide-react';

interface TermsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TermsModal({ isOpen, onClose }: TermsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-gray-900 rounded-lg max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-gray-700">
        <div className="flex-shrink-0 bg-gray-900 border-b border-gray-700 p-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Terms & Conditions</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-2 hover:bg-gray-800 rounded"
            aria-label="Close"
          >
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 text-gray-300 space-y-6">
          <p className="text-sm text-gray-400">Last Updated: January 20, 2026</p>

          <p>
            These Terms & Conditions ("Terms") govern your access to and use of Pipnosis, operated by:
          </p>

          <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
            <p className="font-semibold text-white">PipnosisAi LLC</p>
            <p>2274 N Cobb Parkway</p>
            <p>Suite 109-329</p>
            <p>Kennesaw, GA 30152</p>
            <p>United States</p>
            <p className="mt-2">📧 Support: Aipipnosis@gmail.com</p>
          </div>

          <p>By accessing or using Pipnosis, you agree to be bound by these Terms.</p>

          <section>
            <h3 className="text-xl font-bold text-white mb-3">1. Service Description</h3>
            <p>Pipnosis provides AI-driven market analysis, trade ideas, signals, and educational insights related to financial markets, including forex, cryptocurrencies, indices, and commodities.</p>
            <p className="mt-2 font-semibold text-emerald-400">Pipnosis is a decision-support tool only. It does not provide financial advice or execute trades.</p>
          </section>

          <section>
            <h3 className="text-xl font-bold text-white mb-3">2. Eligibility</h3>
            <p>You must be at least 18 years old to use Pipnosis. By using the platform, you represent that you meet this requirement.</p>
          </section>

          <section>
            <h3 className="text-xl font-bold text-white mb-3">3. No Financial Advisory Relationship</h3>
            <p>Your use of Pipnosis does not create any advisory, fiduciary, or professional relationship between you and PipnosisAi LLC.</p>
          </section>

          <section>
            <h3 className="text-xl font-bold text-white mb-3">4. User Responsibility & Assumption of Risk</h3>
            <p>You expressly acknowledge and agree that:</p>
            <ul className="list-disc ml-6 mt-2 space-y-2">
              <li>All trading decisions are made at your own discretion</li>
              <li>You bear full responsibility for any losses incurred</li>
              <li>Pipnosis does not guarantee accuracy, profitability, or performance</li>
              <li>You agree to use Pipnosis at your own risk.</li>
            </ul>
          </section>

          <section>
            <h3 className="text-xl font-bold text-white mb-3">5. AI-Generated Content Disclaimer</h3>
            <p>You understand that:</p>
            <ul className="list-disc ml-6 mt-2 space-y-2">
              <li>AI outputs may be flawed or incorrect</li>
              <li>Market conditions change rapidly</li>
              <li>System outages, latency, or data inaccuracies may occur</li>
              <li>Pipnosis makes no warranties regarding the accuracy or reliability of AI-generated outputs.</li>
            </ul>
          </section>

          <section>
            <h3 className="text-xl font-bold text-white mb-3">6. Subscriptions, Payments & Credits</h3>
            <ul className="list-disc ml-6 space-y-2">
              <li>Pipnosis operates on a paid subscription and/or token/credit-based model</li>
              <li>Subscriptions may auto-renew unless canceled</li>
              <li>All payments are final</li>
              <li>No refunds, including for unused time, tokens, or credits</li>
              <li>Failure to cancel before renewal constitutes acceptance of charges.</li>
            </ul>
          </section>

          <section>
            <h3 className="text-xl font-bold text-white mb-3">7. Prohibited Use</h3>
            <p>You agree not to:</p>
            <ul className="list-disc ml-6 mt-2 space-y-2">
              <li>Use Pipnosis for unlawful purposes</li>
              <li>Misrepresent Pipnosis outputs as financial advice</li>
              <li>Attempt to reverse engineer, scrape, or abuse the system</li>
            </ul>
            <p className="mt-2 font-semibold text-red-400">Violation may result in immediate termination without refund.</p>
          </section>

          <section>
            <h3 className="text-xl font-bold text-white mb-3">8. Limitation of Liability</h3>
            <p>To the maximum extent permitted by law, PipnosisAi LLC shall not be liable for any:</p>
            <ul className="list-disc ml-6 mt-2 space-y-2">
              <li>Financial losses</li>
              <li>Lost profits</li>
              <li>Missed opportunities</li>
              <li>Indirect, incidental, or consequential damages</li>
            </ul>
            <p className="mt-2">This applies even if Pipnosis was advised of the possibility of such damages.</p>
          </section>

          <section>
            <h3 className="text-xl font-bold text-white mb-3">9. Indemnification</h3>
            <p>You agree to indemnify and hold harmless PipnosisAi LLC, its owners, employees, and affiliates from any claims, losses, or damages arising from your use of the platform or violation of these Terms.</p>
          </section>

          <section>
            <h3 className="text-xl font-bold text-white mb-3">10. Termination</h3>
            <p>Pipnosis reserves the right to suspend or terminate access at any time, with or without notice, for any reason, including violation of these Terms.</p>
          </section>

          <section>
            <h3 className="text-xl font-bold text-white mb-3">11. Governing Law</h3>
            <p>These Terms shall be governed by and construed under the laws of the State of Georgia, United States, without regard to conflict-of-law principles.</p>
          </section>

          <section>
            <h3 className="text-xl font-bold text-white mb-3">12. Modifications</h3>
            <p>Pipnosis may update these Terms at any time. Continued use of the platform constitutes acceptance of the revised Terms.</p>
          </section>
        </div>

        <div className="flex-shrink-0 bg-gray-900 border-t border-gray-700 p-6">
          <button
            onClick={onClose}
            className="w-full bg-emerald-600 text-white py-3 rounded hover:bg-emerald-700 transition-colors font-semibold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
