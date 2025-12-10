import React, { useState } from 'react';
import { NavigationMenu } from '@/components/NavigationMenu';
import { BottomNavigation } from '@/components/BottomNavigation';
import { MarketChart } from '@/components/MarketChart';

export function TradePage() {
  const [selectedSymbol, setSelectedSymbol] = useState<string>('EURUSD');

  return (
    <div className="h-screen w-screen overflow-hidden bg-gray-950 flex flex-col">
      <NavigationMenu />

      <div className="flex-1 overflow-hidden">
        <MarketChart
          symbol={selectedSymbol}
          onSymbolChange={setSelectedSymbol}
        />
      </div>

      <BottomNavigation />
    </div>
  );
}
