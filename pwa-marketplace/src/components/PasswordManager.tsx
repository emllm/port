import React, { useState } from 'react';
import { PasswordEntry } from '../types';

interface PasswordManagerProps {
  entries: PasswordEntry[];
  onAddEntry: (entry: PasswordEntry) => void;
  onUpdateEntry: (entry: PasswordEntry) => void;
  onDeleteEntry: (id: string) => void;
}

const PasswordManager: React.FC<PasswordManagerProps> = ({
  entries,
  onAddEntry,
  onUpdateEntry,
  onDeleteEntry,
}) => {
  const [newEntry, setNewEntry] = useState<Partial<PasswordEntry>>({});
  const [editingEntry, setEditingEntry] = useState<string | null>(null);

  const handleAddEntry = () => {
    if (newEntry.name && newEntry.password) {
      onAddEntry(newEntry as PasswordEntry);
      setNewEntry({});
    }
  };

  const handleEditEntry = (entry: PasswordEntry) => {
    setEditingEntry(entry.id);
    setNewEntry(entry);
  };

  const handleUpdateEntry = () => {
    if (editingEntry && newEntry.name && newEntry.password) {
      onUpdateEntry(newEntry as PasswordEntry);
      setEditingEntry(null);
      setNewEntry({});
    }
  };

  const handleDeleteEntry = (id: string) => {
    onDeleteEntry(id);
  };

  return (
    <div className="password-manager">
      <h2>Password Manager</h2>

      <div className="password-form">
        <input
          type="text"
          placeholder="Service Name"
          value={newEntry.name || ''}
          onChange={(e) => setNewEntry({ ...newEntry, name: e.target.value })}
        />
        <input
          type="password"
          placeholder="Password"
          value={newEntry.password || ''}
          onChange={(e) => setNewEntry({ ...newEntry, password: e.target.value })}
        />
        <button onClick={editingEntry ? handleUpdateEntry : handleAddEntry}>
          {editingEntry ? 'Update' : 'Add'}
        </button>
      </div>

      <div className="password-list">
        {entries.map((entry) => (
          <div key={entry.id} className="password-entry">
            <div className="entry-details">
              <span className="service-name">{entry.name}</span>
              <span className="last-used">Last used: {entry.lastUsed}</span>
            </div>
            <div className="entry-actions">
              <button
                onClick={() => handleEditEntry(entry)}
                className="edit-btn"
              >
                Edit
              </button>
              <button
                onClick={() => handleDeleteEntry(entry.id)}
                className="delete-btn"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PasswordManager;
