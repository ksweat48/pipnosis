import React, { useState } from 'react';
import { DoorOpen, ChevronRight, ChevronLeft } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

interface ClubAccessButtonProps {
  userId: string;
}

export const ClubAccessButton: React.FC<ClubAccessButtonProps> = ({ userId }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(true);

  const isInClub = location.pathname.startsWith('/club');
  const targetRoute = isInClub ? '/trade' : '/club';
  const buttonLabel = isInClub ? 'Return to AI Trading' : 'Enter the Club and Chat with Members';

  const handleNavigate = () => {
    navigate(targetRoute);
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(prev => !prev);
  };

  return (
    <div
      className="fixed left-4 right-4 z-50 flex items-center justify-start"
      style={{ bottom: 'calc(60px + 16px + env(safe-area-inset-bottom))' }}
    >
      <div className="flex items-center bg-purple-600 hover:bg-purple-700 text-white rounded-full shadow-lg transition-all duration-300 overflow-hidden max-w-full">
        <button
          onClick={handleToggle}
          className="flex items-center justify-center p-3 transition-colors duration-200"
          aria-label={isOpen ? 'Collapse label' : 'Expand label'}
        >
          {isOpen ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>

        <div
          className={`flex items-center overflow-hidden transition-all duration-300 ease-in-out ${
            isOpen ? 'max-w-xs opacity-100' : 'max-w-0 opacity-0'
          }`}
        >
          <span className="text-sm font-semibold whitespace-nowrap pr-1">
            {buttonLabel}
          </span>
        </div>

        <button
          onClick={handleNavigate}
          className="flex items-center justify-center p-3 transition-colors duration-200"
          aria-label={buttonLabel}
          title={buttonLabel}
        >
          <DoorOpen size={22} />
        </button>
      </div>
    </div>
  );
};
