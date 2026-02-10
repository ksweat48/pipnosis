import React from 'react';
import { DoorOpen } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ClubAccessButtonProps {
  userId: string;
}

export const ClubAccessButton: React.FC<ClubAccessButtonProps> = ({ userId }) => {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate('/club');
  };

  return (
    <button
      onClick={handleClick}
      className="fixed bottom-20 right-4 z-50 bg-gradient-to-br from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white rounded-full p-4 shadow-lg transition-all duration-300 hover:scale-110"
      aria-label="Access Pipnosis Club"
      title="Pipnosis Club"
    >
      <DoorOpen size={24} />
    </button>
  );
};
