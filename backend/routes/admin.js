import express from "express";
import User from "../models/User.js";
import Clan from "../models/Clan.js";

const router = express.Router();

// Middleware - checks admin key
const adminAuth = (req, res, next) => {
  const key = req.headers["x-admin-key"];
  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ message: "Unauthorized - Wrong Admin Key" });
  }
  next();
};

// GET /api/admin/stats
router.get("/stats", adminAuth, async (req, res) => {
  try {
    const usersCount = await User.countDocuments();
    const clansCount = await Clan.countDocuments();
    
    const latestUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(20)
      .select("name email createdAt");

    const latestClans = await Clan.find()
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      counts: {
        users: usersCount,
        clans: clansCount,
      },
      latestUsers,
      latestClans,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;