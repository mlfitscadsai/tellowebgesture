import { useState } from 'react';
import { FlightCockpit } from './components/FlightCockpit';
import { LandingPage } from './components/LandingPage';
import type { DroneMode } from './types/tello';

export function App() {
  const [view, setView] = useState<'landing' | 'cockpit'>('landing');
  const [initialMode, setInitialMode] = useState<DroneMode>('simulator');

  if (view === 'cockpit') {
    return (
      <FlightCockpit
        initialMode={initialMode}
        onBackToLanding={() => setView('landing')}
      />
    );
  }

  return (
    <LandingPage
      onLaunchCockpit={(mode) => {
        setInitialMode(mode);
        setView('cockpit');
      }}
    />
  );
}

export default App;
