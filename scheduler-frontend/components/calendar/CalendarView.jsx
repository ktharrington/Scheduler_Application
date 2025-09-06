
import React, { useState, useMemo, useEffect, useRef } from "react";
import moment from "moment";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, CheckCircle2, AlertCircle, Clock, Loader2 } from "lucide-react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";

const statusIcons = {
  scheduled: <Clock className="w-3 h-3 text-blue-500" />,
  posting: <Loader2 className="w-3 h-3 text-yellow-500 animate-spin" />,
  posted: <CheckCircle2 className="w-3 h-3 text-green-500" />,
  failed: <AlertCircle className="w-3 h-3 text-red-500" />,
  default: <Clock className="w-3 h-3 text-gray-400" />,
};

// Updated to accept multi-drag flag for styling
const CalendarPost = ({ post, selected, onToggleSelect, onPostSelect, multiDragActive }) => (
  <div
    className={`flex items-center gap-1.5 p-1 rounded-md border shadow-sm hover:shadow-lg transition-all cursor-pointer text-left mb-1 select-none
      ${
        selected
          ? (multiDragActive
              ? "bg-red-50 border-red-300 ring-1 ring-red-300"
              : "bg-purple-50 border-purple-200 ring-1 ring-purple-200")
          : "bg-white border"
      }
    `}
    title={moment(post.scheduled_at).format("h:mm a") + " - " + post.caption}
    onClick={(e) => {
      e.stopPropagation();
      onToggleSelect?.(post, e.shiftKey);
    }}
    onDoubleClick={(e) => {
      e.stopPropagation();
      onPostSelect?.(post);
    }}
  >
    <div className="flex-shrink-0">{statusIcons[post.status] || statusIcons.default}</div>
    <div className="text-xs font-medium text-gray-800 truncate">
      {moment(post.scheduled_at).format("h:mm a")}
    </div>
    <div className="text-xs text-gray-500 truncate ml-auto">
      [{post.media_type ? post.media_type.charAt(0).toUpperCase() : 'P'}]
    </div>
  </div>
);

const CalendarDay = ({ day, isCurrentMonth, isToday, postsForDay, onDayClick, selectedIds = [], onToggleSelect, onPostSelect, droppableId, draggingRef, multiDragActive }) => {
  return (
    <Droppable droppableId={droppableId}>
      {(provided) => (
        <div
          className={`border-r border-b border-gray-100 p-2 flex flex-col min-h-[120px] transition-colors relative ${
            !isCurrentMonth ? "bg-gray-50/70" : "bg-white"
          } ${isToday ? "bg-purple-50" : ""}`}
          onClick={() => {
            // If a drag just happened, ignore the click to prevent accidental navigation
            if (draggingRef?.current) return;
            onDayClick(day.toDate());
          }}
          ref={provided.innerRef}
          {...provided.droppableProps}
        >
          <span
            className={`font-medium mb-2 text-sm ${
              isToday ? "text-purple-600 font-bold" : isCurrentMonth ? "text-gray-800" : "text-gray-400"
            }`}
          >
            {day.date()}
          </span>
          {/* Removed overflow-y-auto to avoid scroll container inside Droppable */}
          <div className="space-y-1">
            {postsForDay.map((post, index) => (
              <Draggable key={post.id} draggableId={String(post.id)} index={index}>
                {(dragProvided) => (
                  <div
                    ref={dragProvided.innerRef}
                    {...dragProvided.draggableProps}
                    {...dragProvided.dragHandleProps}
                    style={{
                      // CRITICAL: apply library-provided style so the item follows the cursor
                      ...(dragProvided.draggableProps.style || {}),
                    }}
                  >
                    <CalendarPost
                      post={post}
                      selected={selectedIds.includes(post.id)}
                      onToggleSelect={onToggleSelect}
                      onPostSelect={onPostSelect}
                      multiDragActive={multiDragActive}
                    />
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        </div>
      )}
    </Droppable>
  );
};

export default function CalendarView({
  posts,
  onDayClick,
  onReplacePost,
  selectedIds = [],
  onToggleSelect,
  onPostSelect,
  onMovePost,
  onMoveSelection,
  onMonthChange,
  // NEW: global prev/next info (optional)
  hasPrevAny,
  hasNextAny,
}) {
  const [currentDate, setCurrentDate] = useState(moment());
  const draggingRef = useRef(false);

  // NEW: multi-drag UI state
  const [multiDragActive, setMultiDragActive] = useState(false);
  const [dragOverlay, setDragOverlay] = useState({ visible: false, x: 0, y: 0, count: 0 });

  useEffect(() => {
    // Notify parent on mount and whenever the current month changes
    if (onMonthChange) onMonthChange(currentDate.clone());
  }, [currentDate, onMonthChange]);

  const monthSummaries = useMemo(() => {
     return posts.reduce((acc, post) => {
        const month = moment(post.scheduled_at).format('YYYY-MM');
        acc[month] = true;
        return acc;
     }, {});
  }, [posts]);

  const currentMonthKey = useMemo(() => currentDate.format("YYYY-MM"), [currentDate]);
  const monthKeys = useMemo(() => Object.keys(monthSummaries || {}), [monthSummaries]);

  // Local calc (from currently loaded posts)
  const localHasPrev = useMemo(() => monthKeys.some(m => m < currentMonthKey), [monthKeys, currentMonthKey]);
  const localHasNext = useMemo(() => monthKeys.some(m => m > currentMonthKey), [monthKeys, currentMonthKey]);

  // Prefer global booleans if provided, else fall back to local
  const showPrevDot = typeof hasPrevAny === "boolean" ? hasPrevAny : localHasPrev;
  const showNextDot = typeof hasNextAny === "boolean" ? hasNextAny : localHasNext;

  const days = useMemo(() => {
    const dayArray = [];
    const start = currentDate.clone().startOf('month').startOf('week');
    const end = currentDate.clone().endOf('month').endOf('week');
    let day = start.clone();
    while (day <= end) {
      dayArray.push(day.clone());
      day.add(1, 'day');
    }
    return dayArray;
  }, [currentDate]);

  // Track cursor to draw overlay
  const handleMouseMove = (e) => {
    setDragOverlay(prev => ({ ...prev, x: e.clientX + 12, y: e.clientY + 12 }));
  };

  const onDragStart = (start) => {
    draggingRef.current = true;
    const draggedId = parseInt(start?.draggableId || "0", 10);
    const isMulti = Array.isArray(selectedIds) && selectedIds.length > 1 && selectedIds.includes(draggedId);
    setMultiDragActive(isMulti);
    if (isMulti) {
      setDragOverlay({ visible: true, x: 0, y: 0, count: selectedIds.length }); // x, y initialized to 0, will be updated by mousemove
      window.addEventListener("mousemove", handleMouseMove);
    } else {
      setDragOverlay({ visible: false, x: 0, y: 0, count: 0 });
    }
  };

  const onDragEnd = (result) => {
    const { destination, source, draggableId } = result || {};

    // Keep "dragging" flag true momentarily so any post-drop click is ignored
    setTimeout(() => { draggingRef.current = false; }, 120);

    // Cleanup overlay
    setMultiDragActive(false);
    window.removeEventListener("mousemove", handleMouseMove);
    setDragOverlay({ visible: false, x: 0, y: 0, count: 0 });

    if (!destination) return; // Dropped outside a droppable
    if (destination.droppableId === source.droppableId) return; // Dropped in the same day -> do nothing

    const destDay = destination.droppableId; // YYYY-MM-DD
    const postId = parseInt(draggableId); // The ID of the dragged post, convert to number

    // If dragging one of the selected items and multiple are selected, treat as multi-move
    if (Array.isArray(selectedIds) && selectedIds.length > 1 && selectedIds.includes(postId) && typeof onMoveSelection === "function") {
      onMoveSelection(selectedIds, destDay);
      return;
    }

    // Otherwise, move a single post
    onMovePost?.(postId, destDay);
  };

  return (
    <Card className="shadow-xl border-0 bg-white/90">
      {/* header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-100">
        <div className="flex items-center gap-2 relative">
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              const next = currentDate.clone().subtract(1, 'month');
              setCurrentDate(next);
            }}
            className="relative"
          >
            {/* Dot shows if any earlier content exists globally or locally */}
            {showPrevDot && (
              <span className="absolute -top-1 left-1 w-2 h-2 rounded-full bg-purple-500 ring-2 ring-white" />
            )}
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              const next = currentDate.clone().add(1, 'month');
              setCurrentDate(next);
            }}
            className="relative"
          >
            {/* Dot shows if any later content exists globally or locally */}
            {showNextDot && (
              <span className="absolute -top-1 right-1 w-2 h-2 rounded-full bg-purple-500 ring-2 ring-white" />
            )}
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const today = moment();
              setCurrentDate(today);
            }}
          >
            Today
          </Button>
        </div>
        <h2 className="text-xl font-semibold text-gray-800">{currentDate.format("MMMM YYYY")}</h2>
      </div>

      <DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-7">
          {moment.weekdaysShort().map(day => (
            <div key={day} className="text-center font-semibold text-sm text-gray-500 py-3 border-r border-b border-gray-100 bg-gray-50/70">{day}</div>
          ))}
          {days.map(day => {
            const postsForDay = posts
              .filter(p => moment(p.scheduled_at).isSame(day, 'day'))
              .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
            const droppableId = day.format('YYYY-MM-DD');
            return (
              <CalendarDay
                key={droppableId}
                day={day}
                isCurrentMonth={day.isSame(currentDate, 'month')}
                isToday={day.isSame(moment(), 'day')}
                postsForDay={postsForDay}
                onDayClick={onDayClick}
                selectedIds={selectedIds}
                onToggleSelect={onToggleSelect}
                onPostSelect={onPostSelect}
                droppableId={droppableId}
                draggingRef={draggingRef}
                multiDragActive={multiDragActive}
              />
            );
          })}
        </div>
      </DragDropContext>

      {/* Floating drag overlay showing how many posts will move */}
      {dragOverlay.visible && dragOverlay.count > 1 && (
        <div
          style={{ position: "fixed", left: dragOverlay.x, top: dragOverlay.y, pointerEvents: "none", zIndex: 60 }}
          className="px-2 py-1 rounded-md text-xs font-semibold bg-red-600 text-white shadow-lg"
        >
          x{dragOverlay.count}
        </div>
      )}
    </Card>
  );
}
