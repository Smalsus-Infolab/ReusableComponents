import React, { useState, useEffect, useRef } from 'react';
import { Search, Plus, X, Check, Menu } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { User } from '../src/types';
import { mockUsers, mockTeams } from '../src/mockData';

// --- SharePoint & Power Automate Integration ---

// Helper to get a unique slug from the URL
const getAppSlug = () => {
  if (typeof window === 'undefined') return 'default-app';
  const hostname = window.location.hostname;
  const parts = hostname.split('-');
  // Usually the 3rd part is the unique slug in AI Studio URLs
  return parts[2] || 'default-task-app';
};

export const SP_CONFIG = {
  siteUrl: 'https://hhhhteams.sharepoint.com/sites/HHHH/SP',
  listId: '0d918d6b-7390-43e3-8049-f4cbaa1209d5',
  listName: 'IndexDB',
  appKey: getAppSlug(), // Dynamic App Key based on URL
  // URL for fetching data (GET flow)
  fetchUrl: 'https://default249283bb0d3b45218dc1e1aff77432.66.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/8efd81cc46a24e228aa9215ae831e40d/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=2SPa_WzU4a4fZvGDYYOLb89aWtIkLLgVlrn_qB8VCgQ',
  // URL for saving data (POST flow)
  saveUrl: 'https://default249283bb0d3b45218dc1e1aff77432.66.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/d67db41b3ed04f63b0268530b2929b4a/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=7hc9pQsUUHd89Nd4riuPLPwdFEo--EOE_XQ56yT6-0c'
};

export interface FetchResult {
  items: any[];
  itemId: number | null;
}

/**
* Fetches items from SharePoint via Power Automate
*/
export const fetchFromSP = async (aiTitle?: string, aiUrl?: string): Promise<FetchResult> => {
  const filter = `Title eq '${SP_CONFIG.appKey}'`;
  const payload = [
    {
      siteUrl: SP_CONFIG.siteUrl,
      listId: SP_CONFIG.listId,
      ListName: SP_CONFIG.listName,
      appKey: SP_CONFIG.appKey,
      AISTitle: aiTitle || 'Untitled AI',
      AISURL: aiUrl || (typeof window !== 'undefined' ? window.location.href : ''),
      columns: `Id, Title, Body&$top=1&$filter=${filter}`
    }
  ];

  try {
    const response = await fetch(SP_CONFIG.fetchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) return { items: [], itemId: null };

    const result = await response.json();
    let bodyContent = '';
    let itemId: number | null = null;
    
    if (Array.isArray(result) && result.length > 0 && result[0].Items && result[0].Items.length > 0) {
      bodyContent = result[0].Items[0].Body;
      itemId = result[0].Items[0].Id;
    } else if (result && result.body && Array.isArray(result.body) && result.body.length > 0 && result.body[0].Items && result.body[0].Items.length > 0) {
      bodyContent = result.body[0].Items[0].Body;
      itemId = result.body[0].Items[0].Id;
    }

    if (!bodyContent) return { items: [], itemId };

    const parsedBody = JSON.parse(bodyContent);
    const finalItems = typeof parsedBody === 'string' ? JSON.parse(parsedBody) : parsedBody;
    return { items: Array.isArray(finalItems) ? finalItems : [], itemId };
  } catch (e) {
    console.error('Error fetching from SP:', e);
    return { items: [], itemId: null };
  }
};

/**
* Creates the initial row for a new AI app in SharePoint
*/
export const createInitialSPRow = async (aiTitle?: string, aiUrl?: string): Promise<number> => {
  const payload = {
    siteUrl: SP_CONFIG.siteUrl,
    listId: SP_CONFIG.listId,
    appKey: SP_CONFIG.appKey,
    AISTitle: aiTitle || 'Untitled AI',
    AISURL: aiUrl || (typeof window !== 'undefined' ? window.location.href : ''),
    itemData: {
      Title: SP_CONFIG.appKey,
      Body: JSON.stringify(JSON.stringify([])),
    },
    action: 'CREATE'
  };

  const response = await fetch(SP_CONFIG.saveUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) throw new Error(`Failed to initialize app row: ${response.status}`);
  const { itemId } = await fetchFromSP(aiTitle, aiUrl);
  if (!itemId) throw new Error("Failed to retrieve ID after creation.");
  return itemId;
};

/**
* Saves items to SharePoint via Power Automate
*/
export const saveToSP = async (updatedItems: any[], itemId: number | null, aiTitle?: string, aiUrl?: string): Promise<number | null> => {
  let targetId = itemId;
  if (targetId === null) {
    targetId = await createInitialSPRow(aiTitle, aiUrl);
  }

  const payload = {
    siteUrl: SP_CONFIG.siteUrl,
    listId: SP_CONFIG.listId,
    itemId: targetId,
    itemData: {
      Body: JSON.stringify(JSON.stringify(updatedItems)),
    },
    action: 'UPDATE'
  };

  const response = await fetch(SP_CONFIG.saveUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) throw new Error(`Failed to save data: ${response.status}`);
  return targetId;
};

// --- UserModal Component ---
export interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (users: User[]) => void;
  initialSelected: User[];
  users: User[];
  teams: string[];
  title?: string;
  searchPlaceholder?: string;
}

export const UserModal: React.FC<UserModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialSelected,
  users,
  teams,
  title = 'Select user for Comment',
  searchPlaceholder = 'Tag user for Comment',
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [hoveredTeam, setHoveredTeam] = useState<string | null>(null);
  const [tempSelected, setTempSelected] = useState<User[]>(initialSelected);

  useEffect(() => {
    if (isOpen) {
      setTempSelected(initialSelected);
      setSearchQuery('');
      setHoveredTeam(null);
    }
  }, [isOpen, initialSelected]);

  const filteredUsers = users.filter((user) => {
    if (searchQuery) {
      return (
        user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.team?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    return user.team === hoveredTeam;
  });

  const handleToggleUser = (user: User) => {
    if (tempSelected.find((u) => u.id === user.id)) {
      setTempSelected(tempSelected.filter((u) => u.id !== user.id));
    } else {
      setTempSelected([...tempSelected, user]);
    }
  };

  const handleRemoveChip = (userId: string) => {
    setTempSelected(tempSelected.filter((u) => u.id !== userId));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-lg shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-[#3b5998]">{title}</h2>
          <div className="flex items-center gap-4">
            <button className="text-gray-400 hover:text-gray-600">
              <Menu size={20} />
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Search Bar & Selected Chips */}
        <div className="p-6 pb-2 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" size={18} />
            <input
              type="text"
              placeholder={searchPlaceholder}
              className="w-full !pl-8 pr-4 py-2 border border-gray-300 rounded focus:outline-none text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Selected Chips in Modal */}
          <div className="flex flex-wrap gap-2 min-h-[32px]">
            {tempSelected.map((user) => (
              <div
                key={user.id}
                className="inline-flex items-center gap-2 px-2 py-1 bg-gray-100 border border-gray-200 rounded-full text-xs text-gray-700"
              >
                <img src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}`} alt="" className="w-5 h-5 rounded-full object-cover" />
                <span>{user.name}</span>
                <button
                  onClick={() => handleRemoveChip(user.id)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden px-6 pb-6 gap-0">
          {!searchQuery ? (
            <>
              {/* Teams List */}
              <div className="w-1/2 border border-gray-200 overflow-y-auto bg-white">
                {teams.map((team) => (
                  <div
                    key={team}
                    onMouseEnter={() => setHoveredTeam(team)}
                    className={`px-4 py-2.5 text-sm cursor-default border-b border-gray-100 last:border-b-0 transition-colors ${
                      hoveredTeam === team ? 'bg-gray-50 font-medium text-gray-900' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {team}
                  </div>
                ))}
              </div>

              {/* Users List (Child) */}
              <div className="w-1/2 border border-gray-200 border-l-0 overflow-y-auto bg-white">
                {hoveredTeam ? (
                  filteredUsers.length > 0 ? (
                    filteredUsers.map((user) => {
                      const isSelected = tempSelected.some((u) => u.id === user.id);
                      return (
                        <div
                          key={user.id}
                          onClick={() => handleToggleUser(user)}
                          className={`flex items-center gap-3 px-4 py-2 border-b border-gray-100 last:border-b-0 cursor-pointer hover:bg-gray-50 transition-colors ${
                            isSelected ? 'bg-blue-50/30' : ''
                          }`}
                        >
                          <img
                            src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}`}
                            alt=""
                            className="w-8 h-8 rounded-full border border-gray-200 object-cover"
                            referrerPolicy="no-referrer"
                          />
                          <span className="text-sm text-gray-700 flex-1">{user.name}</span>
                          {isSelected && <Check size={16} className="text-blue-600" />}
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-4 text-center text-gray-400 text-sm italic">No users in this team</div>
                  )
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-300 text-sm italic">
                    Hover a team to see members
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Search Results View */
            <div className="w-full border border-gray-200 overflow-y-auto bg-white">
              {filteredUsers.length > 0 ? (
                filteredUsers.map((user) => {
                  const isSelected = tempSelected.some((u) => u.id === user.id);
                  return (
                    <div
                      key={user.id}
                      onClick={() => handleToggleUser(user)}
                      className={`px-4 py-2.5 text-sm cursor-pointer border-b border-gray-100 last:border-b-0 transition-colors hover:bg-gray-50 ${
                        isSelected ? 'bg-blue-50/30' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[#4b6ea9]">{user.team}</span>
                          <span className="text-[#4b6ea9]">&gt;</span>
                          <span className="text-[#4b6ea9]">{user.name}</span>
                        </div>
                        {isSelected && <Check size={16} className="text-blue-600" />}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-8 text-center text-gray-400">No users found for "{searchQuery}"</div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={() => onSave(tempSelected)}
            className="px-6 py-2 bg-[#3b5998] text-white rounded text-sm font-medium hover:bg-[#2d4373] transition-colors"
          >
            Save
          </button>
          <button
            onClick={onClose}
            className="px-6 py-2 bg-white border border-[#3b5998] text-[#3b5998] rounded text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </div>
  );
};

// --- Main PeoplePicker Component ---
export interface PeoplePickerProps {
  multiple?: boolean;
  onSelectionChange?: (selected: User[]) => void;
  placeholder?: string;
  label?: string;
  users?: User[];
  teams?: string[];
  value?: User[];
  modalTitle?: string;
  modalSearchPlaceholder?: string;
}

export const PeoplePicker: React.FC<PeoplePickerProps> = ({
  multiple = true,
  onSelectionChange,
  placeholder = 'Search people...',
  label = 'Selected users',
  users = mockUsers,
  teams = mockTeams,
  value,
  modalTitle,
  modalSearchPlaceholder,
}) => {
  const [query, setQuery] = useState('');
  const [internalSelectedUsers, setInternalSelectedUsers] = useState<User[]>([]);
  
  const selectedUsers = value !== undefined ? value : internalSelectedUsers;

  const updateSelectedUsers = (newSelected: User[]) => {
    if (value === undefined) {
      setInternalSelectedUsers(newSelected);
    }
    onSelectionChange?.(newSelected);
  };

  const [suggestions, setSuggestions] = useState<User[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim() === '') {
      setSuggestions([]);
      return;
    }

    const filtered = users.filter(
      (user) =>
        user.name.toLowerCase().includes(query.toLowerCase()) ||
        user.team?.toLowerCase().includes(query.toLowerCase())
    );
    setSuggestions(filtered);
  }, [query, users]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (user: User) => {
    if (multiple) {
      if (!selectedUsers.find((u) => u.id === user.id)) {
        const newSelected = [...selectedUsers, user];
        updateSelectedUsers(newSelected);
      }
    } else {
      updateSelectedUsers([user]);
      setIsOpen(false);
    }
    setQuery('');
    setIsOpen(false);
  };

  const handleRemove = (userId: string) => {
    const newSelected = selectedUsers.filter((u) => u.id !== userId);
    updateSelectedUsers(newSelected);
  };

  const handleModalSave = (users: User[]) => {
    updateSelectedUsers(users);
    setIsModalOpen(false);
  };

  const maxVisibleAvatars = 1;
  const overflowCount = selectedUsers.length > maxVisibleAvatars ? selectedUsers.length - maxVisibleAvatars : 0;
  const overflowUsers = selectedUsers.slice(maxVisibleAvatars);

  return (
    <div className="w-full max-w-md font-sans text-[#333]">
      {/* Selected Users Header */}
      <div className="flex items-center gap-2 mb-1">
        <label className="text-sm font-medium text-[var(--TextBlack)]">{label}</label>
        <div className="flex items-center gap-1">
          {selectedUsers.slice(0, maxVisibleAvatars).map((user) => (
            <div key={user.id} className="relative group">
              <img
                className="h-7 w-7 rounded-full object-cover border border-gray-200"
                src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}`}
                alt={user.name}
                referrerPolicy="no-referrer"
              />
              {/* Custom Name Tooltip */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                {user.name}
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
              </div>
              <button
                type="button"
                onClick={() => handleRemove(user.id)}
                className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={8} />
              </button>
            </div>
          ))}
          {overflowCount > 0 && (
            <div className="relative group">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f0f0f0] text-[12px] font-medium text-[#666] cursor-default">
                +{overflowCount}
              </div>
              {/* Overflow Avatars Popup */}
              <div className="absolute bottom-full left-0 pb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto z-50">
                <div className="p-2 bg-white border border-gray-200 shadow-lg rounded-lg flex gap-1 min-w-max relative">
                  {overflowUsers.map((u) => (
                    <div key={u.id} className="relative group/sub">
                      <img
                        src={u.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name)}`}
                        alt={u.name}
                        className="h-7 w-7 rounded-full border border-gray-100 object-cover"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover/sub:opacity-100 transition-opacity pointer-events-none">
                        {u.name}
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
                      </div>
                    </div>
                  ))}
                  <div className="absolute top-full left-4 border-8 border-transparent border-t-white" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Search Input Container */}
      <div className="relative" ref={dropdownRef}>
        <div className="relative flex items-center">
          <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-gray-300" />
          </div>
          <input
            type="text"
            className="block w-full !pl-12 pr-10 py-1.5 border border-gray-300 rounded-sm leading-5 bg-white placeholder-gray-400 focus:outline-none text-[14px]"
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
          />
          <div className="absolute inset-y-0 right-0 pr-1.5 flex items-center">
            <button
              type="button"
              className="p-1 bg-[#3b5998] text-white rounded-full hover:bg-[#2d4373] focus:outline-none transition-colors"
              onClick={() => setIsModalOpen(true)}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Suggestions Dropdown */}
        <AnimatePresence>
          {isOpen && suggestions.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute z-10 w-full bg-white shadow-sm max-h-60 rounded-sm text-sm overflow-auto focus:outline-none border border-gray-300 border-t-0"
            >
              {suggestions.map((user) => {
                const isSelected = selectedUsers.some((u) => u.id === user.id);
                return (
                  <div
                    key={user.id}
                    className={`cursor-pointer select-none relative py-2 px-3 hover:bg-gray-50 transition-colors ${
                      isSelected ? 'bg-gray-50' : ''
                    }`}
                    onClick={() => handleSelect(user)}
                  >
                    <div className="flex items-center">
                      <div className="truncate text-[14px]">
                        <span className="text-[#4b6ea9]">{user.team}</span>
                        <span className="text-[#4b6ea9] mx-1.5">&gt;</span>
                        <span className="text-[#4b6ea9]">{user.name}</span>
                      </div>
                    </div>

                    {isSelected && (
                      <span className="absolute inset-y-0 right-0 flex items-center pr-3 text-blue-600">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Selected Chips (Optional, for better UX in multi-select) */}
      {multiple && selectedUsers.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {selectedUsers.map((user) => (
            <motion.div
              layout
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              key={user.id}
              className="inline-flex items-center px-2 py-1 rounded-sm text-[12px] bg-gray-100 text-gray-700 border border-gray-200"
              title={user.name}
            >
              <img
                src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}`}
                className="w-4 h-4 rounded-full mr-1.5 object-cover"
                alt=""
                referrerPolicy="no-referrer"
              />
              {user.name}
              <button
                type="button"
                onClick={() => handleRemove(user.id)}
                className="ml-1.5 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={12} />
              </button>
            </motion.div>
          ))}
        </div>
      )}

      {/* Modal */}
      <UserModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleModalSave}
        initialSelected={selectedUsers}
        users={users}
        teams={teams}
        title={modalTitle}
        searchPlaceholder={modalSearchPlaceholder}
      />
    </div>
  );
};
