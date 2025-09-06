import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Zap, Calendar, Clock } from "lucide-react";
import { format, setHours, setMinutes, setSeconds } from "date-fns";

export default function AutoDistributeModal({ open, onClose, selectedAccount, selectedDate, onDistribute, dailyPostCount }) {
  const [formData, setFormData] = useState({
    count: 5,
    start_time: "09:00",
    end_time: "22:00",
    min_spacing: 15
  });
  
  const [proposedTimes, setProposedTimes] = useState([]);
  const [error, setError] = useState(null);

  const generateTimes = () => {
    setError(null);
    setProposedTimes([]);
    const remainingSlots = 15 - dailyPostCount;
    if (formData.count > remainingSlots) {
        setError(`You can only schedule ${remainingSlots} more posts for this day.`);
        return;
    }

    const startMinutes = timeToMinutes(formData.start_time);
    const endMinutes = timeToMinutes(formData.end_time);
    if (endMinutes <= startMinutes) {
        setError("End time must be after start time.");
        return;
    }

    const totalMinutes = endMinutes - startMinutes;
    const interval = Math.floor(totalMinutes / formData.count);
    
    if (interval < formData.min_spacing) {
        setError(`Cannot fit ${formData.count} posts with ${formData.min_spacing}min spacing. Try a wider window or fewer posts.`);
        return;
    }

    const times = [];
    for (let i = 0; i < formData.count; i++) {
      const timeInMinutes = startMinutes + (i * interval);
      times.push(minutesToTime(timeInMinutes));
    }
    
    setProposedTimes(times);
  };

  const timeToMinutes = (time) => {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  };
  
  const minutesToTime = (minutes) => {
      const h = Math.floor(minutes / 60).toString().padStart(2, '0');
      const m = (minutes % 60).toString().padStart(2, '0');
      return `${h}:${m}`;
  }

  const handleAccept = () => {
    const newPosts = proposedTimes.map(time => {
        const [hour, minute] = time.split(':');
        const scheduled_at = setSeconds(setMinutes(setHours(selectedDate, hour), minute), 0);
        return {
            media_url: "https://via.placeholder.com/1080",
            caption: "Your caption here...",
            scheduled_at: scheduled_at.toISOString(),
            status: 'draft',
            media_type: 'photo'
        };
    });
    onDistribute(newPosts);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if(!isOpen) { setProposedTimes([]); setError(null); } onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-purple-500" />
            Auto-Distribute Posts
          </DialogTitle>
          <DialogDescription>
            For @{selectedAccount?.handle} on {format(selectedDate, "MMM d, yyyy")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="count">Posts Count</Label>
              <Input
                id="count" type="number" min="1" max="15"
                value={formData.count}
                onChange={(e) => setFormData({...formData, count: parseInt(e.target.value) || 1})}
              />
            </div>
            <div>
              <Label htmlFor="spacing">Min Spacing (min)</Label>
              <Input
                id="spacing" type="number" min="5"
                value={formData.min_spacing}
                onChange={(e) => setFormData({...formData, min_spacing: parseInt(e.target.value) || 5})}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="start_time">Start Time</Label>
              <Input
                id="start_time" type="time"
                value={formData.start_time}
                onChange={(e) => setFormData({...formData, start_time: e.target.value})}
              />
            </div>
            <div>
              <Label htmlFor="end_time">End Time</Label>
              <Input
                id="end_time" type="time"
                value={formData.end_time}
                onChange={(e) => setFormData({...formData, end_time: e.target.value})}
              />
            </div>
          </div>

          <Button onClick={generateTimes} className="w-full">Generate Times</Button>

          {error && <p className="text-sm text-red-500">{error}</p>}

          {proposedTimes.length > 0 && (
            <div className="space-y-3 pt-4 border-t">
              <Label>Proposed times</Label>
              <div className="flex flex-wrap gap-2">
                {proposedTimes.map((time, index) => (
                  <Badge key={index} variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                    <Clock className="w-3 h-3 mr-1" />
                    {time}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleAccept} disabled={proposedTimes.length === 0} className="bg-gradient-to-r from-purple-500 to-pink-500">Accept & Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}