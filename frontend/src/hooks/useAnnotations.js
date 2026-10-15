import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";

// The reader's highlights, notes and bookmarks for one book, synced with
// the server (GET/POST/PUT/DELETE /api/kenlibs/annotations/:bookId). Loaded
// once per book; changes show immediately and are saved in the background.
// Note and label edits are debounced (one small PUT after typing pauses).
// If loading fails, status is "error" and reading carries on regardless.

const EDIT_SAVE_DELAY_MS = 700;

const useAnnotations = (bookId) => {
  const [annotations, setAnnotations] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [loadCount, setLoadCount] = useState(0);
  const editTimersRef = useRef(new Map()); // id -> { timer, fields }

  useEffect(() => {
    let cancelled = false;
    axiosInstance
      .get(API_PATHS.KENLIBS.ANNOTATIONS(bookId))
      .then((res) => {
        if (cancelled) return;
        setAnnotations(res.data?.annotations || []);
        setStatus("ready");
      })
      .catch(() => !cancelled && setStatus("error"));
    return () => {
      cancelled = true;
    };
  }, [bookId, loadCount]);

  const retry = useCallback(() => {
    setStatus("loading");
    setLoadCount((n) => n + 1);
  }, []);

  const create = useCallback(
    async (body) => {
      try {
        const res = await axiosInstance.post(API_PATHS.KENLIBS.ANNOTATIONS(bookId), body);
        setAnnotations((list) => [...list, res.data]);
        return res.data;
      } catch (error) {
        toast.error(getErrorMessage(error, "Couldn't save that. Please try again."));
        return null;
      }
    },
    [bookId]
  );

  const flushEdit = useCallback(
    (id) => {
      const pending = editTimersRef.current.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      editTimersRef.current.delete(id);
      axiosInstance.put(API_PATHS.KENLIBS.ANNOTATION(bookId, id), pending.fields).catch((error) => {
        toast.error(getErrorMessage(error, "Couldn't save your change. Please try again."));
      });
    },
    [bookId]
  );

  // Updates locally at once; saves after EDIT_SAVE_DELAY_MS (or now, with
  // { immediate: true }, e.g. a color change).
  const update = useCallback(
    (id, fields, { immediate = false } = {}) => {
      setAnnotations((list) => list.map((a) => (a._id === id ? { ...a, ...fields } : a)));
      const pending = editTimersRef.current.get(id);
      if (pending) clearTimeout(pending.timer);
      const merged = { ...(pending?.fields || {}), ...fields };
      editTimersRef.current.set(id, { fields: merged, timer: setTimeout(() => flushEdit(id), immediate ? 0 : EDIT_SAVE_DELAY_MS) });
    },
    [flushEdit]
  );

  const remove = useCallback(
    async (id) => {
      const pending = editTimersRef.current.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        editTimersRef.current.delete(id);
      }
      let removed = null;
      setAnnotations((list) => {
        removed = list.find((a) => a._id === id) || null;
        return list.filter((a) => a._id !== id);
      });
      try {
        await axiosInstance.delete(API_PATHS.KENLIBS.ANNOTATION(bookId, id));
      } catch (error) {
        if (error.response?.status === 404) return; // already gone
        toast.error(getErrorMessage(error, "Couldn't delete that. Please try again."));
        if (removed) setAnnotations((list) => [...list, removed]);
      }
    },
    [bookId]
  );

  // Save anything still waiting when the reader leaves the book.
  useEffect(() => {
    const timers = editTimersRef.current;
    return () => {
      for (const id of [...timers.keys()]) flushEdit(id);
    };
  }, [flushEdit]);

  return { annotations, status, retry, create, update, remove };
};

export default useAnnotations;
