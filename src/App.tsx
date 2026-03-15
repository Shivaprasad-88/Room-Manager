import { useState, useEffect } from 'react';
import { useAuthState } from 'react-firebase-hooks/auth';
import { auth, db, signInWithGoogle, logout } from './firebase';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  setDoc, 
  addDoc, 
  updateDoc, 
  getDoc,
  getDocs,
  deleteDoc,
  deleteField,
  orderBy,
  limit,
  getDocFromServer
} from 'firebase/firestore';
import { 
  LogOut, 
  Plus, 
  Users, 
  Trash2, 
  Droplets, 
  Milk, 
  Banana, 
  MessageSquare, 
  CheckCircle2, 
  Circle, 
  Sparkles,
  Home,
  ArrowRight,
  Info,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  X,
  Crown
} from 'lucide-react';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  addMonths, 
  subMonths 
} from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { UserProfile, Room, Task, Activity } from './types';
import { getTaskRotationAdvice } from './services/gemini';
import { GoogleGenAI } from "@google/genai";
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
  }
}

export default function App() {
  const [user, loading] = useAuthState(auth);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [roomMembers, setRoomMembers] = useState<UserProfile[]>([]);
  const [aiAdvice, setAiAdvice] = useState<string>("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiTip, setAiTip] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [userRooms, setUserRooms] = useState<Room[]>([]);
  const [isManageUsersOpen, setIsManageUsersOpen] = useState(false);
  const [isDeletingRoom, setIsDeletingRoom] = useState(false);
  const [isSwitchRoomOpen, setIsSwitchRoomOpen] = useState(false);

  const handleFirestoreError = (err: any, operation: OperationType, path: string) => {
    const errInfo: FirestoreErrorInfo = {
      error: err instanceof Error ? err.message : String(err),
      operationType: operation,
      path,
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
      }
    };
    console.error('Firestore Error:', JSON.stringify(errInfo));
    setError(`Action failed: ${errInfo.error}`);
    setTimeout(() => setError(null), 5000);
  };

  // Test connection
  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (err) {
        if (err instanceof Error && err.message?.includes('the client is offline')) {
          setError("Firebase is offline. Please check your configuration.");
        }
      }
    };
    testConnection();
  }, []);

  // Sync user profile to Firestore with real-time listener
  useEffect(() => {
    if (user) {
      const userRef = doc(db, 'users', user.uid);
      
      // First, ensure profile exists
      const ensureProfile = async () => {
        try {
          const docSnap = await getDoc(userRef);
          if (!docSnap.exists()) {
            const newProfile: UserProfile = {
              uid: user.uid,
              displayName: user.displayName || 'Anonymous',
              email: user.email || '',
              photoURL: user.photoURL || '',
            };
            await setDoc(userRef, newProfile);
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
        }
      };
      
      ensureProfile();

      // Then listen for changes
      const unsubscribe = onSnapshot(userRef, (docSnap) => {
        if (docSnap.exists()) {
          setProfile(docSnap.data() as UserProfile);
        }
      }, (err) => {
        handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
      });

      return () => unsubscribe();
    } else {
      setProfile(null);
      setRoom(null);
    }
  }, [user]);

  // Fetch AI Tip
  useEffect(() => {
    const fetchTip = async () => {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
      try {
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: "Give a short, one-sentence tip for students living together in a room to maintain harmony and cleanliness. No formatting, just the text.",
        });
        setAiTip(response.text || "");
      } catch (e) {
        console.error("Tip error", e);
      }
    };
    if (user) fetchTip();
  }, [user]);

  // Listen to all rooms user is a member of
  useEffect(() => {
    if (user) {
      const roomsRef = collection(db, 'rooms');
      const q = query(roomsRef, where('members', 'array-contains', user.uid));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room));
        setUserRooms(items);
      }, (err) => {
        handleFirestoreError(err, OperationType.LIST, 'rooms');
      });
      return () => unsubscribe();
    } else {
      setUserRooms([]);
    }
  }, [user]);

  // Listen to Room changes
  useEffect(() => {
    if (profile?.currentRoomId) {
      const roomRef = doc(db, 'rooms', profile.currentRoomId);
      const unsubscribe = onSnapshot(roomRef, (docSnap) => {
        if (docSnap.exists()) {
          const roomData = { id: docSnap.id, ...docSnap.data() } as Room;
          // If user is no longer a member, clear currentRoomId
          if (user && roomData.members && !roomData.members.includes(user.uid)) {
            setDoc(doc(db, 'users', user.uid), { currentRoomId: null }, { merge: true });
            setRoom(null);
          } else {
            setRoom(roomData);
          }
        } else {
          // Room doesn't exist anymore, clear it from user profile
          setRoom(null);
          console.warn("Room not found, clearing currentRoomId");
        }
      }, (err) => {
        handleFirestoreError(err, OperationType.GET, `rooms/${profile.currentRoomId}`);
      });
      return () => unsubscribe();
    } else {
      setRoom(null);
    }
  }, [profile?.currentRoomId, user]);

  const handleLeaveRoom = async () => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'users', user.uid), { currentRoomId: null }, { merge: true });
      setRoom(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'users/leave-room');
    }
  };

  // Listen to Tasks
  useEffect(() => {
    if (room?.id) {
      const tasksRef = collection(db, 'tasks');
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      const q = query(tasksRef, where('roomId', '==', room.id), where('date', '==', dateStr));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task));
        setTasks(items);
      }, (err) => {
        handleFirestoreError(err, OperationType.GET, 'tasks');
      });
      return () => unsubscribe();
    }
  }, [room?.id, selectedDate]);

  // Auto-assign admin for D KRANTHI in room 3OOOK6
  useEffect(() => {
    if (room?.inviteCode === '3OOOK6' && user?.email === 'kranthi95259@gmail.com' && !room.admins?.includes(user.uid)) {
      const assignAdmin = async () => {
        try {
          await updateDoc(doc(db, 'rooms', room.id), {
            admins: [...(room.admins || []), user.uid]
          });
          console.log("Auto-assigned admin for D KRANTHI in room 3OOOK6");
        } catch (err) {
          console.error("Failed to auto-assign admin", err);
        }
      };
      assignAdmin();
    }
  }, [room, user]);

  // Listen to Activities
  useEffect(() => {
    if (room?.id) {
      const activitiesRef = collection(db, 'activities');
      const q = query(activitiesRef, where('roomId', '==', room.id), orderBy('timestamp', 'desc'), limit(20));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Activity));
        setActivities(items);
      });
      return () => unsubscribe();
    }
  }, [room?.id]);

  // Listen to Room Members
  useEffect(() => {
    if (room?.members?.length) {
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('uid', 'in', room.members));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const items = snapshot.docs.map(doc => doc.data() as UserProfile);
        setRoomMembers(items);
      });
      return () => unsubscribe();
    }
  }, [room?.members]);

  const handleCreateRoom = async (name: string) => {
    if (!user) return;
    try {
      const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      const roomData = {
        name,
        createdBy: user.uid,
        admins: [user.uid],
        members: [user.uid],
        inviteCode,
        createdAt: new Date().toISOString()
      };
      const roomRef = await addDoc(collection(db, 'rooms'), roomData);
      await setDoc(doc(db, 'users', user.uid), { currentRoomId: roomRef.id }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'rooms');
    }
  };

  const handleJoinRoom = async (code: string) => {
    if (!user) return;
    try {
      const roomsRef = collection(db, 'rooms');
      const q = query(roomsRef, where('inviteCode', '==', code.toUpperCase()));
      const snapshot = await getDocs(q);
      
      if (!snapshot.empty) {
        const roomDoc = snapshot.docs[0];
        const roomData = roomDoc.data() as Room;
        if (!roomData.members?.includes(user.uid)) {
          await updateDoc(doc(db, 'rooms', roomDoc.id), {
            members: [...(roomData.members || []), user.uid]
          });
        }
        await setDoc(doc(db, 'users', user.uid), { currentRoomId: roomDoc.id }, { merge: true });
      } else {
        alert("Invalid invite code");
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'rooms/join');
    }
  };

  const handleSwitchRoom = async (roomId: string) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'users', user.uid), { currentRoomId: roomId }, { merge: true });
      setIsSwitchRoomOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'users/switch-room');
    }
  };

  const handleRemoveUser = async (targetUid: string) => {
    if (!room || !user) return;
    if (!room.admins?.includes(user.uid)) return;
    if (targetUid === user.uid) return; // Can't remove self

    try {
      const newMembers = (room.members || []).filter(id => id !== targetUid);
      const newAdmins = (room.admins || []).filter(id => id !== targetUid);
      await updateDoc(doc(db, 'rooms', room.id), {
        members: newMembers,
        admins: newAdmins
      });
      
      // Log activity
      const targetUser = roomMembers.find(m => m.uid === targetUid);
      await addDoc(collection(db, 'activities'), {
        roomId: room.id,
        userId: user.uid,
        userName: profile?.nickname || user.displayName,
        message: `removed ${targetUser?.nickname || targetUser?.displayName} from the room`,
        timestamp: new Date().toISOString(),
        type: 'log'
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `rooms/${room.id}/remove-user`);
    }
  };

  const handleLeaveGroup = async () => {
    if (!room || !user) return;
    
    const otherMembers = (room.members || []).filter(id => id !== user.uid);
    
    if (room.createdBy === user.uid) {
      if (otherMembers.length === 0) {
        alert("As the only member and creator, you should delete the room instead of leaving it.");
        return;
      }
      
      if (!window.confirm(`As the creator, leaving will transfer ownership to another member. Are you sure you want to permanently leave "${room.name}"?`)) {
        return;
      }
    } else {
      if (!window.confirm(`Are you sure you want to permanently leave "${room.name}"? You will need an invite code to join again.`)) {
        return;
      }
    }

    try {
      const newMembers = otherMembers;
      const newAdmins = (room.admins || []).filter(id => id !== user.uid);
      
      const updateData: any = {
        members: newMembers,
        admins: newAdmins
      };

      // Transfer ownership if creator is leaving
      if (room.createdBy === user.uid && newMembers.length > 0) {
        // Prefer another admin, otherwise just the first member
        const otherAdmins = newAdmins;
        updateData.createdBy = otherAdmins.length > 0 ? otherAdmins[0] : newMembers[0];
        
        // Ensure the new creator is also an admin
        if (!updateData.admins.includes(updateData.createdBy)) {
          updateData.admins.push(updateData.createdBy);
        }
      }
      
      await updateDoc(doc(db, 'rooms', room.id), updateData);

      await setDoc(doc(db, 'users', user.uid), { currentRoomId: null }, { merge: true });
      
      // Log activity
      await addDoc(collection(db, 'activities'), {
        roomId: room.id,
        userId: user.uid,
        userName: profile?.nickname || user.displayName,
        message: 'left the group permanently',
        timestamp: new Date().toISOString(),
        type: 'log'
      });

      setRoom(null);
      setIsManageUsersOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `rooms/${room.id}/leave-group`);
    }
  };

  const handleToggleAdmin = async (targetUid: string) => {
    if (!room || !user) return;
    if (!room.admins?.includes(user.uid)) return;

    try {
      let newAdmins;
      if (room.admins?.includes(targetUid)) {
        if (room.createdBy === targetUid) return; // Can't remove creator from admins
        newAdmins = room.admins.filter(id => id !== targetUid);
      } else {
        newAdmins = [...room.admins, targetUid];
      }
      
      await updateDoc(doc(db, 'rooms', room.id), { admins: newAdmins });
      
      // Log activity
      const targetUser = roomMembers.find(m => m.uid === targetUid);
      const isNowAdmin = newAdmins?.includes(targetUid);
      await addDoc(collection(db, 'activities'), {
        roomId: room.id,
        userId: user.uid,
        userName: profile?.nickname || user.displayName,
        message: `${isNowAdmin ? 'promoted' : 'demoted'} ${targetUser?.nickname || targetUser?.displayName} ${isNowAdmin ? 'to admin' : 'from admin'}`,
        timestamp: new Date().toISOString(),
        type: 'log'
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `rooms/${room.id}/toggle-admin`);
    }
  };

  const handleTransferOwnership = async (targetUid: string) => {
    if (!room || !user) return;
    if (room.createdBy !== user.uid) return;
    if (targetUid === user.uid) return;

    const targetUser = roomMembers.find(m => m.uid === targetUid);
    if (!window.confirm(`Are you sure you want to transfer ownership of "${room.name}" to ${targetUser?.nickname || targetUser?.displayName}? You will remain an admin but will no longer be the owner.`)) {
      return;
    }

    try {
      const newAdmins = Array.from(new Set([...(room.admins || []), targetUid]));
      await updateDoc(doc(db, 'rooms', room.id), { 
        createdBy: targetUid,
        admins: newAdmins
      });
      
      // Log activity
      await addDoc(collection(db, 'activities'), {
        roomId: room.id,
        userId: user.uid,
        userName: profile?.nickname || user.displayName,
        message: `transferred ownership of the group to ${targetUser?.nickname || targetUser?.displayName}`,
        timestamp: new Date().toISOString(),
        type: 'log'
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `rooms/${room.id}/transfer-ownership`);
    }
  };

  const handleDeleteRoom = async () => {
    if (!room || !user) return;
    if (room.createdBy !== user.uid) {
      alert("Only the room creator can delete the room.");
      return;
    }

    if (!window.confirm(`Are you sure you want to delete "${room.name}"? This action cannot be undone.`)) {
      return;
    }

    setIsDeletingRoom(true);
    try {
      // 1. Delete all tasks in the room
      const tasksRef = collection(db, 'tasks');
      const tasksQuery = query(tasksRef, where('roomId', '==', room.id));
      const tasksSnapshot = await getDocs(tasksQuery);
      const taskDeletes = tasksSnapshot.docs.map(d => deleteDoc(d.ref));
      
      // 2. Delete all activities in the room
      const activitiesRef = collection(db, 'activities');
      const activitiesQuery = query(activitiesRef, where('roomId', '==', room.id));
      const activitiesSnapshot = await getDocs(activitiesQuery);
      const activityDeletes = activitiesSnapshot.docs.map(d => deleteDoc(d.ref));

      // 3. Delete the room itself
      await Promise.all([...taskDeletes, ...activityDeletes]);
      await deleteDoc(doc(db, 'rooms', room.id));

      // 4. Update user profile to remove currentRoomId
      await updateDoc(doc(db, 'users', user.uid), { currentRoomId: deleteField() });
      
      setIsManageUsersOpen(false);
      setRoom(null);
    } catch (err) {
      console.error("Error deleting room:", err);
      alert("Failed to delete room. Please check your connection and try again.");
      handleFirestoreError(err, OperationType.DELETE, `rooms/${room.id}`);
    } finally {
      setIsDeletingRoom(false);
    }
  };

  const handleUpdateNickname = async (nickname: string) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), { nickname });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}/nickname`);
    }
  };

  const handleTakeOverTask = async (task: Task) => {
    if (!room || !user) return;
    try {
      await updateDoc(doc(db, 'tasks', task.id), { assignedTo: user.uid });
      
      // Log activity
      await addDoc(collection(db, 'activities'), {
        roomId: room.id,
        userId: user.uid,
        userName: profile?.nickname || user.displayName,
        message: `took over task: ${task.title}`,
        timestamp: new Date().toISOString(),
        type: 'log'
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tasks/${task.id}/takeover`);
    }
  };

  const handleAddTask = async (title: string, type: Task['type'], assignedTo: string) => {
    if (!room) return;
    try {
      await addDoc(collection(db, 'tasks'), {
        roomId: room.id,
        title,
        type,
        assignedTo,
        status: 'pending',
        date: format(selectedDate, 'yyyy-MM-dd')
      });
      
      // Log activity
      const assignedUser = roomMembers.find(m => m.uid === assignedTo);
      await addDoc(collection(db, 'activities'), {
        roomId: room.id,
        userId: user?.uid,
        userName: profile?.nickname || user?.displayName,
        message: `assigned ${title} to ${assignedUser?.nickname || assignedUser?.displayName} for ${format(selectedDate, 'MMM do')}`,
        timestamp: new Date().toISOString(),
        type: 'log'
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'tasks');
    }
  };

  const handleDeleteTask = async (taskId: string, title: string) => {
    if (!room) return;
    try {
      await deleteDoc(doc(db, 'tasks', taskId));
      
      // Log activity
      await addDoc(collection(db, 'activities'), {
        roomId: room.id,
        userId: user?.uid,
        userName: profile?.nickname || user?.displayName,
        message: `removed task: ${title}`,
        timestamp: new Date().toISOString(),
        type: 'log'
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `tasks/${taskId}`);
    }
  };

  const toggleTask = async (task: Task) => {
    if (!room || !user) return;
    const newStatus = task.status === 'pending' ? 'completed' : 'pending';
    await updateDoc(doc(db, 'tasks', task.id), { status: newStatus });
    
    if (newStatus === 'completed') {
      await addDoc(collection(db, 'activities'), {
        roomId: room.id,
        userId: user.uid,
        userName: profile?.nickname || user.displayName,
        message: `completed task: ${task.title}`,
        timestamp: new Date().toISOString(),
        type: 'log'
      });
    }
  };

  const sendChat = async (message: string) => {
    if (!room || !user) return;
    await addDoc(collection(db, 'activities'), {
      roomId: room.id,
      userId: user.uid,
      userName: profile?.nickname || user.displayName,
      message,
      timestamp: new Date().toISOString(),
      type: 'chat'
    });
  };

  const getAiAdvice = async () => {
    if (!room || !tasks.length) return;
    setIsAiLoading(true);
    const memberNames = roomMembers.map(m => m.displayName);
    const taskTitles = tasks.map(t => t.title);
    const advice = await getTaskRotationAdvice(memberNames, taskTitles);
    setAiAdvice(advice || "No advice available.");
    setIsAiLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          className="w-12 h-12 border-4 border-[#5A5A40] border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex flex-col items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-[32px] p-12 shadow-xl text-center"
        >
          <div className="w-20 h-20 bg-[#5A5A40] rounded-full flex items-center justify-center mx-auto mb-8">
            <Home className="text-white w-10 h-10" />
          </div>
          <h1 className="text-4xl font-serif font-bold text-[#1a1a1a] mb-4">RoomMate</h1>
          <p className="text-[#5A5A40] mb-12 italic">The smart way to manage your student room chores.</p>
          <button 
            onClick={signInWithGoogle}
            className="w-full bg-[#5A5A40] text-white rounded-full py-4 px-8 font-medium flex items-center justify-center gap-3 hover:bg-[#4A4A30] transition-colors"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-6 h-6 bg-white rounded-full p-1" alt="Google" />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  if (!profile?.currentRoomId || !room) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex flex-col items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-4xl w-full mb-8 bg-white rounded-[32px] p-8 shadow-lg"
        >
          <div className="flex flex-col md:flex-row items-center gap-6 pb-8 border-b border-gray-100 mb-8">
            <img 
              src={profile?.photoURL} 
              className="w-20 h-20 rounded-full border-4 border-white shadow-md" 
              referrerPolicy="no-referrer"
            />
            <div className="flex-1 text-center md:text-left">
              <h2 className="text-2xl font-serif font-bold">Welcome, {profile?.displayName}</h2>
              <p className="text-gray-500 text-sm mb-4">Set a nickname so your roommates know who you are.</p>
              <div className="flex items-center gap-2 max-w-xs mx-auto md:mx-0">
                <input 
                  type="text"
                  defaultValue={profile?.nickname || ''}
                  placeholder="Your Nickname"
                  className="flex-1 bg-gray-50 border-none rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-[#5A5A40] outline-none"
                  onBlur={(e) => handleUpdateNickname(e.target.value)}
                />
                <Sparkles size={18} className="text-[#5A5A40]" />
              </div>
            </div>
          </div>

          {userRooms.length > 0 && (
            <>
              <h2 className="text-xl font-serif font-bold mb-6">Your Rooms</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {userRooms.map(r => (
                  <button 
                    key={r.id}
                    onClick={() => handleSwitchRoom(r.id)}
                    className="flex items-center justify-between p-4 rounded-2xl border border-gray-100 hover:border-[#5A5A40] hover:bg-gray-50 transition-all text-left"
                  >
                    <div>
                      <p className="font-bold">{r.name}</p>
                      <p className="text-xs text-gray-500">{r.members.length} members</p>
                    </div>
                    <ArrowRight size={18} className="text-gray-400" />
                  </button>
                ))}
              </div>
            </>
          )}
        </motion.div>

        {profile?.currentRoomId && !room ? (
          <div className="text-center space-y-4">
            <motion.div 
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              className="w-12 h-12 border-4 border-[#5A5A40] border-t-transparent rounded-full mx-auto"
            />
            <p className="text-gray-500 italic">Finding your room...</p>
            <button 
              onClick={handleLeaveRoom}
              className="text-sm text-[#5A5A40] underline"
            >
              Stuck? Click here to go back
            </button>
          </div>
        ) : (
          <div className="max-w-4xl w-full grid md:grid-cols-2 gap-8">
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-white rounded-[32px] p-10 shadow-lg"
            >
              <h2 className="text-2xl font-serif font-bold mb-6">Create a Room</h2>
              <p className="text-gray-600 mb-8">Start a new shared space and invite your roommates.</p>
              <form onSubmit={(e) => {
                e.preventDefault();
                const name = (e.target as any).roomName.value;
                if (name) handleCreateRoom(name);
              }}>
                <input 
                  name="roomName"
                  placeholder="Room Name (e.g. Flat 302)"
                  className="w-full border-b-2 border-gray-200 py-3 mb-8 focus:border-[#5A5A40] outline-none transition-colors"
                  required
                />
                <button className="w-full bg-[#5A5A40] text-white rounded-full py-4 font-medium hover:bg-[#4A4A30] transition-colors">
                  Create Room
                </button>
              </form>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-white rounded-[32px] p-10 shadow-lg"
            >
              <h2 className="text-2xl font-serif font-bold mb-6">Join a Room</h2>
              <p className="text-gray-600 mb-8">Enter an invite code to join your friends.</p>
              <form onSubmit={(e) => {
                e.preventDefault();
                const code = (e.target as any).inviteCode.value;
                if (code) handleJoinRoom(code);
              }}>
                <input 
                  name="inviteCode"
                  placeholder="Invite Code (e.g. AB12CD)"
                  className="w-full border-b-2 border-gray-200 py-3 mb-8 focus:border-[#5A5A40] outline-none transition-colors"
                  required
                />
                <button className="w-full border-2 border-[#5A5A40] text-[#5A5A40] rounded-full py-4 font-medium hover:bg-[#5A5A40] hover:text-white transition-all">
                  Join Room
                </button>
              </form>
            </motion.div>
          </div>
        )}
        <button onClick={logout} className="mt-12 text-gray-500 flex items-center gap-2 hover:text-[#5A5A40]">
          <LogOut size={18} /> Sign Out
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-[#1a1a1a]">
      {/* Error Toast */}
      <AnimatePresence>
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-500 text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-2"
          >
            <Info size={18} />
            <span>{error}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSwitchRoomOpen(true)}
              className="w-10 h-10 bg-[#5A5A40] rounded-full flex items-center justify-center hover:scale-105 transition-transform"
              title="Switch Room"
            >
              <Home className="text-white w-6 h-6" />
            </button>
            <div>
              <h1 className="font-serif font-bold text-xl">{room?.name}</h1>
              <p className="text-xs text-[#5A5A40] font-medium tracking-widest uppercase">Code: {room?.inviteCode}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 mr-2">
              <span className="text-xs font-bold text-[#5A5A40] hidden sm:block">
                {profile?.nickname || profile?.displayName}
              </span>
              <div className="flex -space-x-2">
                {roomMembers.map(member => (
                  <img 
                    key={member.uid}
                    src={member.photoURL || `https://ui-avatars.com/api/?name=${member.displayName}`}
                    className="w-8 h-8 rounded-full border-2 border-white"
                    title={member.nickname ? `${member.nickname} (${member.displayName})` : member.displayName}
                    referrerPolicy="no-referrer"
                  />
                ))}
              </div>
            </div>
            <div className="h-6 w-px bg-gray-200 mx-2" />
            
            <button 
              onClick={() => setIsManageUsersOpen(true)}
              className="p-2 text-gray-400 hover:text-[#5A5A40] transition-colors"
              title={room?.admins?.includes(user?.uid || '') ? "Manage Users" : "Group Members"}
            >
              <Users size={20} />
            </button>

            <button 
              onClick={handleLeaveRoom}
              className="p-2 text-gray-400 hover:text-red-500 transition-colors"
              title="Exit Current Room"
            >
              <LogOut size={20} />
            </button>
            <button onClick={logout} className="p-2 text-gray-400 hover:text-[#5A5A40] transition-colors" title="Sign Out">
              <LogOut size={20} className="rotate-180" />
            </button>
          </div>
        </div>
      </header>

      {/* Modals */}
      <AnimatePresence>
        {isSwitchRoomOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSwitchRoomOpen(false)}
              className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-lg bg-white rounded-[32px] p-8 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-serif font-bold">Switch Room</h2>
                <button onClick={() => setIsSwitchRoomOpen(false)} className="p-2 hover:bg-gray-100 rounded-full"><X size={20} /></button>
              </div>
              <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
                {userRooms.map(r => (
                  <button 
                    key={r.id}
                    onClick={() => handleSwitchRoom(r.id)}
                    className={cn(
                      "w-full flex items-center justify-between p-4 rounded-2xl border transition-all text-left",
                      r.id === room?.id ? "border-[#5A5A40] bg-gray-50" : "border-gray-100 hover:bg-gray-50"
                    )}
                  >
                    <div>
                      <p className="font-bold">{r.name}</p>
                      <p className="text-xs text-gray-500">{r.members.length} members</p>
                    </div>
                    {r.id === room?.id && <CheckCircle2 size={18} className="text-[#5A5A40]" />}
                  </button>
                ))}
                <button 
                  onClick={() => {
                    handleLeaveRoom();
                    setIsSwitchRoomOpen(false);
                  }}
                  className="w-full flex items-center gap-3 p-4 rounded-2xl border border-dashed border-gray-200 text-gray-500 hover:bg-gray-50 transition-all"
                >
                  <Plus size={18} />
                  <span>Create or Join New Room</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {isManageUsersOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsManageUsersOpen(false)}
              className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-lg bg-white rounded-[32px] p-8 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-serif font-bold">
                  {room?.admins?.includes(user?.uid || '') ? "Manage Users" : "Group Members"}
                </h2>
                <button onClick={() => setIsManageUsersOpen(false)} className="p-2 hover:bg-gray-100 rounded-full"><X size={20} /></button>
              </div>
              <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                {roomMembers.map(member => (
                  <div key={member.uid} className="flex items-center justify-between p-4 rounded-2xl bg-gray-50">
                    <div className="flex items-center gap-3">
                      <img 
                        src={member.photoURL || `https://ui-avatars.com/api/?name=${member.displayName}`}
                        className="w-10 h-10 rounded-full border border-gray-200"
                        referrerPolicy="no-referrer"
                      />
                      <div>
                        <p className="font-bold text-sm">{member.nickname || member.displayName}</p>
                        <p className="text-xs text-gray-500">
                          {member.nickname ? `(${member.displayName})` : ''}
                          {room?.admins?.includes(member.uid) ? ' • Admin' : ' • Member'}
                          {room?.createdBy === member.uid && ' (Creator)'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {user?.uid === member.uid ? (
                        <button 
                          onClick={handleLeaveGroup}
                          className="text-xs font-bold px-3 py-1 rounded-full border border-red-200 text-red-500 hover:bg-red-50 transition-all"
                        >
                          Leave Group
                        </button>
                      ) : (
                        <>
                          {room?.createdBy === user?.uid && (
                            <button 
                              onClick={() => handleTransferOwnership(member.uid)}
                              className="p-2 text-gray-400 hover:text-amber-500 transition-colors"
                              title="Transfer Ownership"
                            >
                              <Crown size={18} />
                            </button>
                          )}
                          {room?.admins?.includes(user?.uid || '') && (
                            <>
                              <button 
                                onClick={() => handleToggleAdmin(member.uid)}
                                className={cn(
                                  "text-xs font-bold px-3 py-1 rounded-full border transition-all",
                                  room?.admins?.includes(member.uid) 
                                    ? "border-gray-200 text-gray-500 hover:bg-white" 
                                    : "border-[#5A5A40] text-[#5A5A40] hover:bg-[#5A5A40] hover:text-white"
                                )}
                              >
                                {room?.admins?.includes(member.uid) ? 'Revoke Admin' : 'Make Admin'}
                              </button>
                              <button 
                                onClick={() => handleRemoveUser(member.uid)}
                                className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                                title="Remove from Room"
                              >
                                <Trash2 size={18} />
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-8 p-4 bg-gray-100 rounded-2xl space-y-4">
                <p className="text-xs text-gray-500 text-center">
                  Invite Code: <span className="font-mono font-bold text-[#5A5A40]">{room?.inviteCode}</span>
                </p>
                {room?.createdBy === user?.uid && (
                  <button 
                    onClick={handleDeleteRoom}
                    disabled={isDeletingRoom}
                    className={cn(
                      "w-full py-3 px-4 bg-red-50 text-red-600 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2",
                      isDeletingRoom ? "opacity-50 cursor-not-allowed" : "hover:bg-red-100"
                    )}
                  >
                    {isDeletingRoom ? (
                      <div className="w-4 h-4 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Trash2 size={16} />
                    )}
                    {isDeletingRoom ? 'Deleting...' : 'Delete Room Permanently'}
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <main className="max-w-6xl mx-auto p-6 grid lg:grid-cols-3 gap-8">
        {/* Left Column: Tasks */}
        <div className="lg:col-span-2 space-y-8">
          {/* AI Tip Banner */}
          {aiTip && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white border-l-4 border-[#5A5A40] p-4 rounded-r-2xl shadow-sm flex items-start gap-3"
            >
              <Info className="text-[#5A5A40] shrink-0 mt-0.5" size={18} />
              <p className="text-sm text-gray-600 italic">{aiTip}</p>
            </motion.div>
          )}

          <section className="bg-white rounded-[32px] p-8 shadow-sm">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-4">
                <h2 className="text-2xl font-serif font-bold">
                  {isSameDay(selectedDate, new Date()) ? "Today's Chores" : `Chores for ${format(selectedDate, 'MMM do')}`}
                </h2>
                <button 
                  onClick={() => setIsCalendarOpen(!isCalendarOpen)}
                  className={cn(
                    "p-2 rounded-xl transition-all",
                    isCalendarOpen ? "bg-[#5A5A40] text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  )}
                >
                  <CalendarIcon size={20} />
                </button>
              </div>
              <span className="text-sm text-gray-400">{format(selectedDate, 'EEEE, MMM do')}</span>
            </div>

            <AnimatePresence>
              {isCalendarOpen && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden mb-8"
                >
                  <div className="bg-gray-50 rounded-3xl p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-bold text-[#5A5A40]">{format(selectedDate, 'MMMM yyyy')}</h3>
                      <div className="flex gap-2">
                        <button onClick={() => setSelectedDate(subMonths(selectedDate, 1))} className="p-1 hover:bg-gray-200 rounded-lg"><ChevronLeft size={20} /></button>
                        <button onClick={() => setSelectedDate(addMonths(selectedDate, 1))} className="p-1 hover:bg-gray-200 rounded-lg"><ChevronRight size={20} /></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-gray-400 uppercase mb-2">
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d}>{d}</div>)}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {(() => {
                        const monthStart = startOfMonth(selectedDate);
                        const monthEnd = endOfMonth(monthStart);
                        const startDate = startOfWeek(monthStart);
                        const endDate = endOfWeek(monthEnd);
                        const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

                        return calendarDays.map(day => (
                          <button
                            key={day.toString()}
                            onClick={() => setSelectedDate(day)}
                            className={cn(
                              "aspect-square flex items-center justify-center rounded-xl text-sm transition-all relative",
                              !isSameMonth(day, monthStart) && "text-gray-300",
                              isSameDay(day, selectedDate) && "bg-[#5A5A40] text-white font-bold shadow-md",
                              isSameDay(day, new Date()) && !isSameDay(day, selectedDate) && "text-[#5A5A40] font-bold border border-[#5A5A40]/20",
                              !isSameDay(day, selectedDate) && isSameMonth(day, monthStart) && "hover:bg-gray-200"
                            )}
                          >
                            {format(day, 'd')}
                          </button>
                        ));
                      })()}
                    </div>
                    <div className="mt-4 flex justify-end">
                      <button 
                        onClick={() => {
                          setSelectedDate(new Date());
                          setIsCalendarOpen(false);
                        }}
                        className="text-xs font-bold text-[#5A5A40] hover:underline"
                      >
                        Back to Today
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="space-y-4 mb-8">
              {tasks.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed border-gray-100 rounded-3xl">
                  <p className="text-gray-400">No tasks for this date.</p>
                </div>
              ) : (
                tasks.map(task => (
                  <motion.div 
                    layout
                    key={task.id}
                    className={cn(
                      "flex items-center justify-between p-4 rounded-2xl border transition-all group",
                      task.status === 'completed' ? "bg-gray-50 border-transparent opacity-60" : "bg-white border-gray-100 shadow-sm"
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <button onClick={() => toggleTask(task)} className="text-[#5A5A40]">
                        {task.status === 'completed' ? <CheckCircle2 size={24} /> : <Circle size={24} />}
                      </button>
                      <div>
                        <h3 className={cn("font-medium", task.status === 'completed' && "line-through")}>{task.title}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs px-2 py-0.5 bg-gray-100 rounded-full text-gray-500 capitalize">{task.type}</span>
                          <span className="text-xs text-gray-400">
                            Assigned to: {(() => {
                              const assignedUser = roomMembers.find(m => m.uid === task.assignedTo);
                              return assignedUser?.nickname || assignedUser?.displayName || 'Unknown';
                            })()}
                          </span>
                          {task.assignedTo !== user?.uid && task.status === 'pending' && (
                            <button 
                              onClick={() => handleTakeOverTask(task)}
                              className="text-[10px] font-bold text-[#5A5A40] hover:underline uppercase tracking-tighter"
                            >
                              Take Over
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-[#5A5A40]">
                        {task.type === 'garbage' && <Trash2 size={18} />}
                        {task.type === 'water' && <Droplets size={18} />}
                        {task.type === 'milk' && <Milk size={18} />}
                        {task.type === 'banana' && <Banana size={18} />}
                      </div>
                      <button 
                        onClick={() => handleDeleteTask(task.id, task.title)}
                        className="p-2 text-gray-300 hover:text-red-500 transition-all"
                        title="Delete Task"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </motion.div>
                ))
              )}
            </div>

            {/* Add Task Form */}
            <div className="pt-8 border-t border-gray-100">
              <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-4">Add New Task</h3>
              <form onSubmit={(e) => {
                e.preventDefault();
                const form = e.target as any;
                handleAddTask(form.title.value, form.type.value, form.assignedTo.value);
                form.reset();
              }} className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <input name="title" placeholder="Task title..." className="col-span-2 md:col-span-1 border-b border-gray-200 py-2 outline-none focus:border-[#5A5A40]" required />
                <select name="type" className="border-b border-gray-200 py-2 outline-none focus:border-[#5A5A40] bg-transparent">
                  <option value="garbage">Garbage</option>
                  <option value="water">Water</option>
                  <option value="milk">Milk</option>
                  <option value="banana">Banana</option>
                  <option value="other">Other</option>
                </select>
                <select name="assignedTo" className="border-b border-gray-200 py-2 outline-none focus:border-[#5A5A40] bg-transparent">
                  {roomMembers.map(m => (
                    <option key={m.uid} value={m.uid}>{m.displayName}</option>
                  ))}
                </select>
                <button className="bg-[#5A5A40] text-white rounded-full py-2 px-4 flex items-center justify-center gap-2 hover:bg-[#4A4A30]">
                  <Plus size={18} /> Add
                </button>
              </form>
            </div>
          </section>

          {/* AI Advice Section */}
          <section className="bg-[#5A5A40] text-white rounded-[32px] p-8 shadow-lg relative overflow-hidden">
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <Sparkles className="text-[#D4D4A0]" />
                  <h2 className="text-2xl font-serif font-bold">AI Rotation Advice</h2>
                </div>
                <button 
                  onClick={getAiAdvice}
                  disabled={isAiLoading || tasks.length === 0}
                  className="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-full text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {isAiLoading ? "Thinking..." : "Get Advice"}
                </button>
              </div>
              {aiAdvice ? (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="bg-white/5 rounded-2xl p-6 border border-white/10"
                >
                  <p className="leading-relaxed italic">{aiAdvice}</p>
                </motion.div>
              ) : (
                <p className="text-white/60 italic">Ask Gemini to suggest a fair task rotation for today based on who's around!</p>
              )}
            </div>
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-32 -mt-32 blur-3xl" />
          </section>
        </div>

        {/* Right Column: Activity & Chat */}
        <div className="space-y-8">
          <section className="bg-white rounded-[32px] p-8 shadow-sm h-[600px] flex flex-col">
            <div className="flex items-center gap-3 mb-6">
              <MessageSquare className="text-[#5A5A40]" />
              <h2 className="text-2xl font-serif font-bold">Room Feed</h2>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 mb-6 pr-2 custom-scrollbar">
              {activities.map(activity => (
                <div key={activity.id} className={cn(
                  "p-3 rounded-2xl",
                  activity.type === 'chat' ? "bg-gray-50 ml-4" : "bg-[#F5F5F0] mr-4 text-xs italic text-gray-500"
                )}>
                  {activity.type === 'chat' && (
                    <p className="text-[10px] font-bold text-[#5A5A40] uppercase tracking-wider mb-1">{activity.userName}</p>
                  )}
                  <p className="text-sm">{activity.message}</p>
                  <p className="text-[9px] text-gray-400 mt-1">{format(new Date(activity.timestamp), 'HH:mm')}</p>
                </div>
              ))}
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              const input = (e.target as any).message;
              if (input.value) {
                sendChat(input.value);
                input.value = '';
              }
            }} className="relative">
              <input 
                name="message"
                placeholder="Share something..."
                className="w-full bg-gray-100 rounded-full py-4 pl-6 pr-12 outline-none focus:ring-2 ring-[#5A5A40]/20"
              />
              <button className="absolute right-2 top-2 w-10 h-10 bg-[#5A5A40] text-white rounded-full flex items-center justify-center hover:bg-[#4A4A30]">
                <ArrowRight size={18} />
              </button>
            </form>
          </section>

          <section className="bg-white rounded-[32px] p-8 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <Users className="text-[#5A5A40]" />
              <h2 className="text-2xl font-serif font-bold">Roommates</h2>
            </div>
            <div className="space-y-4">
              {roomMembers.map(member => (
                <div key={member.uid} className="flex items-center gap-3">
                  <img 
                    src={member.photoURL || `https://ui-avatars.com/api/?name=${member.displayName}`}
                    className="w-10 h-10 rounded-full"
                    referrerPolicy="no-referrer"
                  />
                  <div>
                    <p className="font-medium text-sm">{member.displayName}</p>
                    <p className="text-xs text-green-600">Active</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
