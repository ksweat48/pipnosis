import React from 'react';
import { AlertCircle } from 'lucide-react';

export const AdminDashboard: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center glass-card p-12 max-w-md">
          <AlertCircle className="h-16 w-16 text-amber-400 mx-auto mb-6" />
          <h2 className="text-2xl font-bold text-white mb-4">Admin Dashboard</h2>
          <p className="text-white/60 mb-6">
            Admin dashboard functionality is currently being developed. 
            Check back soon for comprehensive analytics and user management tools.
          </p>
          <a 
            href="/"
            className="inline-flex items-center space-x-2 px-6 py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors font-medium"
          >
            <span>Back to Dashboard</span>
          </a>
        </div>
      </div>
    </div>
  );
};