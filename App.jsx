import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { 
  BookOpen, 
  MessageSquare, 
  Layers, 
  Send, 
  Plus, 
  Loader2, 
  Trash2, 
  Sparkles, 
  ChevronRight, 
  ChevronLeft,
  Menu,
  X
} from 'lucide-react';

// Firebase Setup
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'ai-study-assistant-default';

// Gemini API Helper
const callGemini = async (prompt, systemInstruction = null, jsonSchema = null) => {
  const apiKey = ""; // API key is handled by the platform environment
  let model = "gemini-3-flash-preview";
  let apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }]
  };

  if (systemInstruction) {
    payload.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  if (jsonSchema) {
    payload.generationConfig = {
      responseMimeType: "application/json",
      responseSchema: jsonSchema
    };
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const result = await response.json();
    if (result.candidates && result.candidates.length > 0) {
      return result.candidates[0].content.parts[0].text;
    }
    return null;
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};

export default function App() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('notes'); // 'notes', 'chat', 'flashcards'
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
  // Data State
  const [notes, setNotes] = useState([]);
  const [flashcards, setFlashcards] = useState([]);
  const [chatHistory, setChatHistory] = useState([]);
  
  // UI State
  const [currentNote, setCurrentNote] = useState({ title: '', content: '' });
  const [currentChatId, setCurrentChatId] = useState(null);
  const [chatInput, setChatInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState(null);
  const chatEndRef = useRef(null);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth error:", err);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const notesRef = collection(db, 'artifacts', appId, 'users', user.uid, 'notes');
    const unsubscribeNotes = onSnapshot(notesRef, (snapshot) => {
      const fetchedNotes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Sort in memory to avoid complex query indexes
      setNotes(fetchedNotes.sort((a, b) => b.createdAt - a.createdAt));
    }, (err) => console.error("Notes fetch error:", err));

    const flashcardsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'flashcards');
    const unsubscribeFlashcards = onSnapshot(flashcardsRef, (snapshot) => {
      const fetchedCards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setFlashcards(fetchedCards.sort((a, b) => b.createdAt - a.createdAt));
    }, (err) => console.error("Flashcards fetch error:", err));

    const chatsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'chats');
    const unsubscribeChats = onSnapshot(chatsRef, (snapshot) => {
      const fetchedChats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setChatHistory(fetchedChats.sort((a, b) => b.createdAt - a.createdAt));
      
      // If we don't have an active chat but we have history, maybe select the first one
      // Or let user explicitly create a new one.
    }, (err) => console.error("Chats fetch error:", err));

    return () => {
      unsubscribeNotes();
      unsubscribeFlashcards();
      unsubscribeChats();
    };
  }, [user]);

  useEffect(() => {
    if (activeTab === 'chat') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, activeTab, currentChatId]);

  const handleSaveNote = async () => {
    if (!user || !currentNote.title || !currentNote.content) return;
    try {
      if (currentNote.id) {
        await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'notes', currentNote.id), {
          title: currentNote.title,
          content: currentNote.content,
          updatedAt: Date.now()
        });
      } else {
        await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'notes'), {
          title: currentNote.title,
          content: currentNote.content,
          createdAt: Date.now()
        });
        setCurrentNote({ title: '', content: '' }); // Reset after save
      }
    } catch (e) {
      console.error("Error saving note:", e);
    }
  };

  const handleProcessNote = async (action) => {
    if (!currentNote.content) return;
    setIsLoading(true);
    setLoadingAction(action);
    
    try {
      if (action === 'summarize' || action === 'explain') {
        const prompt = action === 'summarize' 
          ? `Summarize the following study notes concisely, highlighting key points:\n\n${currentNote.content}`
          : `Explain the complex concepts in these notes as if I am a beginner trying to learn them. Use analogies if helpful:\n\n${currentNote.content}`;
        
        const systemInstruction = "You are a helpful AI study assistant.";
        const response = await callGemini(prompt, systemInstruction);
        
        // Append response to the current note content or create a new section
        setCurrentNote(prev => ({
          ...prev,
          content: prev.content + `\n\n--- AI ${action === 'summarize' ? 'Summary' : 'Explanation'} ---\n` + response
        }));
      } else if (action === 'flashcards') {
        const prompt = `Create a list of educational flashcards based on the following notes. Extract key terms, facts, and concepts.\n\nNotes:\n${currentNote.content}`;
        const schema = {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              "question": { "type": "STRING", "description": "The front of the flashcard." },
              "answer": { "type": "STRING", "description": "The back of the flashcard." }
            },
            required: ["question", "answer"]
          }
        };
        
        const responseText = await callGemini(prompt, "You are an expert tutor creating study flashcards.", schema);
        if (responseText) {
          const cards = JSON.parse(responseText);
          // Save flashcards to Firestore
          for (const card of cards) {
            await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'flashcards'), {
              question: card.question,
              answer: card.answer,
              sourceNoteTitle: currentNote.title || 'Untitled Note',
              createdAt: Date.now()
            });
          }
          alert(`Successfully generated and saved ${cards.length} flashcards! Check the Flashcards tab.`);
        }
      }
    } catch (e) {
      console.error(`Error processing note for ${action}:`, e);
      alert("Failed to process with AI. Please try again.");
    } finally {
      setIsLoading(false);
      setLoadingAction(null);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !user) return;
    
    const userMessage = chatInput.trim();
    setChatInput('');
    setIsLoading(true);

    let chatId = currentChatId;
    let currentMessages = [];

    if (!chatId) {
      // Create new chat session
      const newChatRef = await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'chats'), {
        title: userMessage.substring(0, 30) + '...',
        messages: [{ role: 'user', text: userMessage, timestamp: Date.now() }],
        createdAt: Date.now()
      });
      chatId = newChatRef.id;
      setCurrentChatId(chatId);
      currentMessages = [{ role: 'user', text: userMessage }];
    } else {
      // Append to existing
      const chat = chatHistory.find(c => c.id === chatId);
      if (chat) {
        currentMessages = [...chat.messages, { role: 'user', text: userMessage, timestamp: Date.now() }];
        await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'chats', chatId), {
          messages: currentMessages,
          updatedAt: Date.now()
        });
      }
    }

    // Call Gemini
    try {
      // Build conversation history for prompt
      let promptContext = currentMessages.map(m => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.text}`).join('\n');
      promptContext += '\nTutor: ';
      
      const systemInstruction = "You are an encouraging, highly knowledgeable AI Study Tutor. Help the student understand concepts, solve problems, and prepare for exams. Keep responses relatively concise but informative.";
      const aiResponse = await callGemini(promptContext, systemInstruction);

      if (aiResponse) {
        const updatedMessages = [...currentMessages, { role: 'ai', text: aiResponse, timestamp: Date.now() }];
        await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'chats', chatId), {
          messages: updatedMessages,
          updatedAt: Date.now()
        });
      }
    } catch (e) {
      console.error("Chat Error:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const deleteDocument = async (collectionName, id) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, collectionName, id));
      if (collectionName === 'chats' && currentChatId === id) {
        setCurrentChatId(null);
      }
      if (collectionName === 'notes' && currentNote.id === id) {
        setCurrentNote({ title: '', content: '' });
      }
    } catch (e) {
      console.error("Error deleting doc:", e);
    }
  };

  const Flashcard = ({ card }) => {
    const [isFlipped, setIsFlipped] = useState(false);
    return (
      <div 
        className="relative w-full h-64 perspective-1000 cursor-pointer group"
        onClick={() => setIsFlipped(!isFlipped)}
      >
        <div className={`w-full h-full transition-transform duration-500 transform-style-3d ${isFlipped ? 'rotate-y-180' : ''}`}>
          {/* Front */}
          <div className="absolute w-full h-full backface-hidden bg-white border border-slate-200 rounded-xl shadow-sm p-6 flex flex-col justify-center items-center text-center hover:shadow-md transition-shadow">
            <p className="text-xs text-slate-400 absolute top-4 left-4 font-semibold uppercase tracking-wider">Question</p>
            <button 
              onClick={(e) => { e.stopPropagation(); deleteDocument('flashcards', card.id); }}
              className="absolute top-4 right-4 text-slate-300 hover:text-red-500 transition-colors"
            >
              <Trash2 size={16} />
            </button>
            <h3 className="text-lg font-medium text-slate-800">{card.question}</h3>
            {card.sourceNoteTitle && (
              <span className="absolute bottom-4 text-xs text-indigo-500 bg-indigo-50 px-2 py-1 rounded-full">
                {card.sourceNoteTitle}
              </span>
            )}
          </div>
          {/* Back */}
          <div className="absolute w-full h-full backface-hidden bg-indigo-600 text-white rounded-xl shadow-md p-6 flex flex-col justify-center items-center text-center rotate-y-180">
            <p className="text-xs text-indigo-200 absolute top-4 left-4 font-semibold uppercase tracking-wider">Answer</p>
            <p className="text-lg">{card.answer}</p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans overflow-hidden">
      
      {/* Sidebar Overlay for Mobile */}
      {!isSidebarOpen && (
        <button 
          className="md:hidden fixed top-4 left-4 z-50 p-2 bg-white rounded-md shadow-md text-slate-600"
          onClick={() => setIsSidebarOpen(true)}
        >
          <Menu size={20} />
        </button>
      )}

      {/* Sidebar */}
      <div className={`${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} transform md:translate-x-0 transition-transform duration-300 fixed md:relative z-40 w-64 h-full bg-white border-r border-slate-200 flex flex-col`}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2 text-indigo-600">
            <Sparkles size={24} className="fill-indigo-100" />
            <h1 className="text-xl font-bold tracking-tight text-slate-800">StudyAI</h1>
          </div>
          <button className="md:hidden text-slate-400 hover:text-slate-600" onClick={() => setIsSidebarOpen(false)}>
            <X size={20} />
          </button>
        </div>

        <nav className="p-4 space-y-2">
          <button 
            onClick={() => setActiveTab('notes')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg font-medium transition-colors ${activeTab === 'notes' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <BookOpen size={18} /> Notes & Processing
          </button>
          <button 
            onClick={() => setActiveTab('chat')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg font-medium transition-colors ${activeTab === 'chat' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <MessageSquare size={18} /> AI Tutor Chat
          </button>
          <button 
            onClick={() => setActiveTab('flashcards')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg font-medium transition-colors ${activeTab === 'flashcards' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <Layers size={18} /> My Flashcards
          </button>
        </nav>

        <div className="flex-1 overflow-y-auto p-4 border-t border-slate-100">
          {activeTab === 'notes' && (
            <div>
              <div className="flex items-center justify-between mb-3 text-sm font-semibold text-slate-500 uppercase tracking-wider">
                Saved Notes
                <button onClick={() => setCurrentNote({title: '', content: ''})} className="text-indigo-600 hover:text-indigo-800">
                  <Plus size={16} />
                </button>
              </div>
              <ul className="space-y-1">
                {notes.map(note => (
                  <li key={note.id} className="group flex items-center justify-between rounded p-2 hover:bg-slate-100 cursor-pointer">
                    <span onClick={() => setCurrentNote(note)} className="truncate text-sm text-slate-700">{note.title || 'Untitled'}</span>
                    <button onClick={() => deleteDocument('notes', note.id)} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500">
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
                {notes.length === 0 && <p className="text-xs text-slate-400">No saved notes yet.</p>}
              </ul>
            </div>
          )}

          {activeTab === 'chat' && (
            <div>
              <div className="flex items-center justify-between mb-3 text-sm font-semibold text-slate-500 uppercase tracking-wider">
                Recent Chats
                <button onClick={() => setCurrentChatId(null)} className="text-indigo-600 hover:text-indigo-800">
                  <Plus size={16} />
                </button>
              </div>
              <ul className="space-y-1">
                {chatHistory.map(chat => (
                  <li key={chat.id} className={`group flex items-center justify-between rounded p-2 cursor-pointer ${currentChatId === chat.id ? 'bg-indigo-50' : 'hover:bg-slate-100'}`}>
                    <span onClick={() => setCurrentChatId(chat.id)} className={`truncate text-sm ${currentChatId === chat.id ? 'text-indigo-700 font-medium' : 'text-slate-700'}`}>{chat.title}</span>
                    <button onClick={() => deleteDocument('chats', chat.id)} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500">
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
                {chatHistory.length === 0 && <p className="text-xs text-slate-400">No chat history.</p>}
              </ul>
            </div>
          )}
        </div>
        
        {/* User Status / Bottom Footer */}
        <div className="p-4 border-t border-slate-200 text-xs text-slate-500">
          {user ? `User: ${user.uid.substring(0, 8)}...` : 'Connecting...'}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full bg-slate-50 relative">
        
        {/* Notes View */}
        {activeTab === 'notes' && (
          <div className="flex-1 flex flex-col max-w-5xl mx-auto w-full p-4 md:p-8 overflow-y-auto">
            <h2 className="text-2xl font-bold text-slate-800 mb-6 flex items-center gap-2">
              <BookOpen className="text-indigo-600" /> 
              {currentNote.id ? 'Edit Note' : 'New Note'}
            </h2>
            
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 flex flex-col overflow-hidden">
              <input 
                type="text" 
                placeholder="Note Title..."
                value={currentNote.title}
                onChange={(e) => setCurrentNote({...currentNote, title: e.target.value})}
                className="w-full p-4 text-lg font-semibold border-b border-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
              <textarea
                placeholder="Paste your study material or notes here..."
                value={currentNote.content}
                onChange={(e) => setCurrentNote({...currentNote, content: e.target.value})}
                className="w-full flex-1 p-4 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-100 font-mono text-sm text-slate-700 leading-relaxed"
              />
              <div className="bg-slate-50 p-4 border-t border-slate-200 flex flex-wrap gap-3 items-center justify-between">
                <button 
                  onClick={handleSaveNote}
                  className="px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors font-medium text-sm"
                >
                  Save Note
                </button>
                <div className="flex gap-2 flex-wrap">
                  <button 
                    onClick={() => handleProcessNote('summarize')}
                    disabled={isLoading || !currentNote.content}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition-colors font-medium text-sm disabled:opacity-50"
                  >
                    {loadingAction === 'summarize' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                    Summarize
                  </button>
                  <button 
                    onClick={() => handleProcessNote('explain')}
                    disabled={isLoading || !currentNote.content}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors font-medium text-sm disabled:opacity-50"
                  >
                    {loadingAction === 'explain' ? <Loader2 size={16} className="animate-spin" /> : <BookOpen size={16} />}
                    Explain Complexity
                  </button>
                  <button 
                    onClick={() => handleProcessNote('flashcards')}
                    disabled={isLoading || !currentNote.content}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200 transition-colors font-medium text-sm disabled:opacity-50"
                  >
                    {loadingAction === 'flashcards' ? <Loader2 size={16} className="animate-spin" /> : <Layers size={16} />}
                    Generate Flashcards
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Chat View */}
        {activeTab === 'chat' && (
          <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full p-4 md:p-8">
             <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
                
                {/* Chat Header */}
                <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                  <h3 className="font-semibold text-slate-700 flex items-center gap-2">
                    <MessageSquare size={18} className="text-indigo-600" />
                    AI Tutor {currentChatId && chatHistory.find(c => c.id === currentChatId) ? `- ${chatHistory.find(c => c.id === currentChatId).title}` : '(New Session)'}
                  </h3>
                </div>

                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
                  {currentChatId && chatHistory.find(c => c.id === currentChatId)?.messages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] p-4 rounded-2xl ${
                        msg.role === 'user' 
                          ? 'bg-indigo-600 text-white rounded-br-none shadow-sm' 
                          : 'bg-white text-slate-800 border border-slate-200 rounded-bl-none shadow-sm'
                      }`}>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.text}</p>
                      </div>
                    </div>
                  ))}
                  
                  {!currentChatId && (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
                      <Sparkles size={48} className="text-indigo-200" />
                      <p>Start a new conversation with your AI Tutor.</p>
                      <p className="text-sm max-w-sm text-center">Ask it to quiz you, explain a topic, or help you brainstorm essay ideas.</p>
                    </div>
                  )}
                  
                  {isLoading && (
                    <div className="flex justify-start">
                       <div className="bg-white text-slate-800 border border-slate-200 p-4 rounded-2xl rounded-bl-none shadow-sm flex gap-2 items-center text-sm text-slate-500">
                         <Loader2 size={16} className="animate-spin text-indigo-600" /> Tutor is typing...
                       </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-4 bg-white border-t border-slate-100">
                  <div className="flex items-center gap-2">
                    <input 
                      type="text" 
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                      placeholder="Ask the tutor a question..."
                      className="flex-1 p-3 bg-slate-100 rounded-lg border-transparent focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none"
                    />
                    <button 
                      onClick={handleSendMessage}
                      disabled={isLoading || !chatInput.trim()}
                      className="p-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                      <Send size={20} />
                    </button>
                  </div>
                </div>

             </div>
          </div>
        )}

        {/* Flashcards View */}
        {activeTab === 'flashcards' && (
          <div className="flex-1 flex flex-col mx-auto w-full p-4 md:p-8 overflow-y-auto">
            <div className="max-w-6xl w-full mx-auto">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                  <Layers className="text-indigo-600" /> 
                  My Flashcards
                </h2>
                <span className="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-sm font-semibold">
                  {flashcards.length} Cards
                </span>
              </div>
              
              {flashcards.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-xl border border-slate-200 border-dashed">
                  <Layers size={48} className="mx-auto text-slate-300 mb-4" />
                  <h3 className="text-lg font-medium text-slate-700 mb-2">No flashcards yet</h3>
                  <p className="text-slate-500 max-w-md mx-auto">
                    Go to the Notes tab, paste some study material, and click "Generate Flashcards" to create your study deck.
                  </p>
                  <button 
                    onClick={() => setActiveTab('notes')}
                    className="mt-6 px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                  >
                    Go to Notes
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {flashcards.map(card => (
                    <Flashcard key={card.id} card={card} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      
      {/* Required CSS for 3D Flip Effects */}
      <style dangerouslySetInnerHTML={{__html: `
        .perspective-1000 {
          perspective: 1000px;
        }
        .transform-style-3d {
          transform-style: preserve-3d;
        }
        .backface-hidden {
          backface-visibility: hidden;
        }
        .rotate-y-180 {
          transform: rotateY(180deg);
        }
      `}} />
    </div>
  );
}
