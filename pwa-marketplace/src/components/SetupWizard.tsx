import React, { useState } from 'react';

interface SetupWizardProps {
  onComplete: () => void;
}

const SetupWizard: React.FC<SetupWizardProps> = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    githubToken: '',
    storagePath: '',
  });

  const steps = [
    {
      title: 'Welcome',
      content: (
        <div>
          <h3>Welcome to PWA Marketplace</h3>
          <p>Let's get started with your setup!</p>
        </div>
      ),
    },
    {
      title: 'Account Setup',
      content: (
        <div>
          <h3>Create Account</h3>
          <input
            type="text"
            placeholder="Username"
            value={formData.username}
            onChange={(e) =>
              setFormData({ ...formData, username: e.target.value })
            }
          />
          <input
            type="password"
            placeholder="Password"
            value={formData.password}
            onChange={(e) =>
              setFormData({ ...formData, password: e.target.value })
            }
          />
        </div>
      ),
    },
    {
      title: 'GitHub Integration',
      content: (
        <div>
          <h3>GitHub Token</h3>
          <input
            type="text"
            placeholder="GitHub Personal Access Token"
            value={formData.githubToken}
            onChange={(e) =>
              setFormData({ ...formData, githubToken: e.target.value })
            }
          />
        </div>
      ),
    },
    {
      title: 'Storage Setup',
      content: (
        <div>
          <h3>Storage Path</h3>
          <input
            type="text"
            placeholder="Storage Path"
            value={formData.storagePath}
            onChange={(e) =>
              setFormData({ ...formData, storagePath: e.target.value })
            }
          />
        </div>
      ),
    },
  ];

  const handleNext = () => {
    if (currentStep < steps.length) {
      setCurrentStep(currentStep + 1);
    } else {
      onComplete();
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <div className="setup-wizard">
      <div className="wizard-header">
        <h2>Setup Wizard</h2>
        <div className="progress-bar">
          <div
            className="progress"
            style={{ width: `${(currentStep / steps.length) * 100}%` }}
          />
        </div>
        <div className="step-indicator">
          {steps.map((_, index) => (
            <span
              key={index}
              className={`step ${currentStep > index + 1 ? 'completed' : ''}`}
            />
          ))}
        </div>
      </div>

      <div className="wizard-content">
        <h3>{steps[currentStep - 1].title}</h3>
        {steps[currentStep - 1].content}
      </div>

      <div className="wizard-footer">
        <button
          onClick={handleBack}
          disabled={currentStep === 1}
          className="back-btn"
        >
          Back
        </button>
        <button onClick={handleNext} className="next-btn">
          {currentStep === steps.length ? 'Complete' : 'Next'}
        </button>
      </div>
    </div>
  );
};

export default SetupWizard;
