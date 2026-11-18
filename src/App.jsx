import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import {
  Wallet,
  LayoutDashboard,
  Compass,
  PlusCircle,
  HandCoins,
  ShieldCheck,
  Menu,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  Clock3,
  Coins,
  LogOut,
  ArrowRight,
  AlertCircle,
  FileCheck,
  Vote,
  History,
} from "lucide-react";
import {
  ADDRESS,
  CHAIN_ID,
  ABI,
  readProvider,
  readContract,
  writeContract,
  eth,
} from "./contract";
const short = (a) => (a ? `${a.slice(0, 6)}...${a.slice(-4)}` : "");
const fmtDate = (ts) => new Date(Number(ts) * 1000).toLocaleString("th-TH");
const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const remainingTime = (deadline, now) => {
  const seconds = Math.max(0, Number(deadline) - Math.floor(now / 1000));
  if (!seconds) return "หมดเวลาแล้ว";
  if (seconds < 60) return "เหลือน้อยกว่า 1 นาที";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `เหลือ ${days} วัน ${hours} ชม.`;
  if (hours) return `เหลือ ${hours} ชม. ${minutes} นาที`;
  return `เหลือ ${minutes} นาที`;
};
const eventLabel = (event) => {
  if (event.name === "CampaignCreated") return "สร้างโครงการ";
  if (event.name === "Contributed") return "เงินสนับสนุนเข้า";
  if (event.name === "ReleaseRequested") return "ส่งหลักฐานขอเบิก";
  if (event.name === "Voted")
    return event.args[3] ? "ลงคะแนนเห็นชอบ" : "ลงคะแนนไม่เห็นชอบ";
  if (event.name === "FundsReleased") return "จ่ายเงินออก";
  if (event.name === "Refunded") return "คืนเงิน";
  return event.name;
};
const eventAmount = (event) => {
  if (event.name === "Contributed" || event.name === "FundsReleased" || event.name === "Refunded")
    return event.args[2];
  if (event.name === "Voted") return event.args[4];
  return null;
};
const initial = {
  title: "",
  description: "",
  goal: "",
  days: "7",
  milestones: [{ title: "", amount: "" }],
};
function App() {
  const [account, setAccount] = useState("");
  const [admin, setAdmin] = useState("");
  const [campaigns, setCampaigns] = useState([]);
  const [tab, setTab] = useState("explore");
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(initial);
  const [contribute, setContribute] = useState("0.01");
  const [evidence, setEvidence] = useState({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [events, setEvents] = useState([]);
  const [dashboardEvents, setDashboardEvents] = useState([]);
  const [overviewMilestones, setOverviewMilestones] = useState([]);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewLimit, setOverviewLimit] = useState(8);
  const [now, setNow] = useState(Date.now());
  const [mobile, setMobile] = useState(false);
  const isAdmin = same(account, admin);
  const owned = useMemo(
    () => campaigns.filter((c) => same(c.creator, account)),
    [campaigns, account],
  );
  const backed = useMemo(
    () => campaigns.filter((c) => BigInt(c.mine || 0) > 0n),
    [campaigns],
  );
  const roles = account
    ? [
        isAdmin ? "Admin" : null,
        owned.length ? "Creator" : null,
        backed.length ? "Backer" : null,
      ].filter(Boolean)
    : ["Guest"];
  const navigation = [
    { id: "dashboard", label: "ภาพรวม", icon: LayoutDashboard },
    { id: "explore", label: "สำรวจโครงการ", icon: Compass },
    ...(account
      ? [{ id: "create", label: "สร้างโครงการ", icon: PlusCircle }]
      : []),
    ...(owned.length
      ? [{ id: "mine", label: "โครงการของฉัน", icon: FileCheck }]
      : []),
    ...(backed.length
      ? [{ id: "backed", label: "การสนับสนุนของฉัน", icon: HandCoins }]
      : []),
    ...(isAdmin
      ? [{ id: "admin", label: "ผู้ดูแลระบบ", icon: ShieldCheck }]
      : []),
  ];
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const load = useCallback(async () => {
    if (!ADDRESS || !readProvider) return;
    setLoading(true);
    try {
      const c = readContract();
      const [count, owner] = await Promise.all([c.campaignCount(), c.admin()]);
      setAdmin(owner);
      const ids = Array.from(
        { length: Math.min(Number(count), 200) },
        (_, i) => i + 1,
      );
      const data = await Promise.all(
        ids.map(async (id) => {
          const x = await c.campaigns(id);
          const mine = account ? await c.contributions(id, account) : 0n;
          return {
            id,
            creator: x.creator,
            title: x.title,
            description: x.description,
            goal: x.goal,
            deadline: x.deadline,
            raised: x.raised,
            released: x.released,
            refunded: x.refunded,
            milestoneCount: Number(x.milestoneCount),
            mine,
          };
        }),
      );
      setCampaigns(data.reverse());
      const tip = await readProvider.getBlockNumber();
      const logs = await readProvider.getLogs({
        address: ADDRESS,
        fromBlock: Math.max(0, tip - 9000),
        toBlock: tip,
      });
      const iface = new ethers.Interface(ABI);
      const parsed = logs
        .map((log) => {
          try {
            const event = iface.parseLog(log);
            return event
              ? { event, hash: log.transactionHash, blockNumber: log.blockNumber }
              : null;
          } catch {
            return null;
          }
        })
        .filter((entry) => entry && Number(entry.event.args[0]) > 0)
        .reverse()
        .slice(0, 30);
      setDashboardEvents(parsed);
    } catch (e) {
      setMessage({ error: true, text: e.shortMessage || e.message });
    } finally {
      setLoading(false);
    }
  }, [account]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (tab !== "dashboard" || !campaigns.length) {
      setOverviewMilestones([]);
      return;
    }
    let cancelled = false;
    setOverviewLoading(true);
    const readLatest = async () => {
      const c = readContract();
      const rows = await Promise.all(
        campaigns.slice(0, overviewLimit).map(async (campaign) => {
          const milestones = await Promise.all(
            Array.from({ length: campaign.milestoneCount }, (_, index) =>
              c.getMilestone(campaign.id, index),
            ),
          );
          return {
            id: campaign.id,
            title: campaign.title,
            milestones: milestones.map((milestone, index) => ({
              index,
              title: milestone.title,
              amount: milestone.amount,
              status: milestone.paid
                ? "จ่ายแล้ว"
                : milestone.requested
                  ? now / 1000 < Number(milestone.voteDeadline)
                    ? "กำลังเปิดโหวต"
                    : milestone.approvals > milestone.votingPowerSnapshot / 2n
                      ? "โหวตผ่าน · รอจ่าย"
                      : "โหวตไม่ผ่าน"
                  : now / 1000 < Number(campaign.deadline)
                    ? campaign.raised >= campaign.goal
                      ? "รอปิดระดมทุน"
                      : "ระหว่างระดมทุน"
                    : campaign.raised < campaign.goal
                      ? "ระดมทุนไม่ถึงเป้า"
                      : index > 0 && !milestones[index - 1].paid
                        ? "รอ Milestone ก่อนหน้า"
                        : "รอส่งหลักฐาน",
            })),
          };
        }),
      );
      if (!cancelled) setOverviewMilestones(rows);
    };
    readLatest()
      .catch(() => {
        if (!cancelled) setOverviewMilestones([]);
      })
      .finally(() => {
        if (!cancelled) setOverviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, campaigns, now, overviewLimit]);
  useEffect(() => {
    if (!window.ethereum) return;
    const changed = (a) => {
      setAccount(a[0] || "");
      setSelected(null);
      setDetail(null);
    };
    const chain = () => {
      setSelected(null);
      setDetail(null);
      load();
    };
    window.ethereum.on("accountsChanged", changed);
    window.ethereum.on("chainChanged", chain);
    window.ethereum
      .request({ method: "eth_accounts" })
      .then(changed)
      .catch(() => {});
    return () => {
      window.ethereum.removeListener("accountsChanged", changed);
      window.ethereum.removeListener("chainChanged", chain);
    };
  }, [load]);
  const connect = async () => {
    try {
      if (!window.ethereum) throw Error("กรุณาติดตั้ง MetaMask");
      const a = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      setAccount(a[0] || "");
    } catch (e) {
      setMessage({ error: true, text: e.message });
    }
  };
  const transaction = async (fn) => {
    setBusy(true);
    setMessage(null);
    try {
      const contract = await writeContract();
      const tx = await fn(contract);
      setMessage({ text: `ส่งธุรกรรมแล้ว ${short(tx.hash)} — กำลังยืนยัน...` });
      await tx.wait();
      setMessage({ text: "ธุรกรรมสำเร็จบน Blockchain" });
      await load();
      if (selected) await openCampaign(selected.id);
    } catch (e) {
      setMessage({
        error: true,
        text: e.reason || e.shortMessage || e.message,
      });
    } finally {
      setBusy(false);
    }
  };
  const openCampaign = async (id) => {
    try {
      const c = readContract();
      const x = await c.campaigns(id);
      const ms = await Promise.all(
        Array.from({ length: Number(x.milestoneCount) }, (_, i) =>
          c.getMilestone(id, i),
        ),
      );
      const votes = account
        ? await Promise.all(ms.map((_, i) => c.hasVoted(id, i, account)))
        : [];
      const mine = account ? await c.contributions(id, account) : 0n;
      setDetail({ ms, votes, mine });
      setSelected({
        id,
        creator: x.creator,
        title: x.title,
        description: x.description,
        goal: x.goal,
        deadline: x.deadline,
        raised: x.raised,
        released: x.released,
        refunded: x.refunded,
        milestoneCount: Number(x.milestoneCount),
      });
      setTab("detail");
      setEvents([]);
      try {
        const filter = ethers.id(
          "CampaignCreated(uint256,address,string,uint256)",
        );
        void filter;
        const logs = await readProvider.getLogs({
          address: ADDRESS,
          fromBlock: Math.max(0, (await readProvider.getBlockNumber()) - 9000),
          toBlock: "latest",
        });
        const iface = new ethers.Interface(ABI);
        const parsed = logs
          .map((l) => {
            try {
              return { event: iface.parseLog(l), hash: l.transactionHash };
            } catch {
              return null;
            }
          })
          .filter(
            (x) =>
              x?.event &&
              [
                "Contributed",
                "ReleaseRequested",
                "Voted",
                "FundsReleased",
                "Refunded",
              ].includes(x.event.name) &&
              Number(x.event.args[0]) === id,
          );
        setEvents(parsed.reverse().slice(0, 25));
      } catch {
        setEvents([]);
      }
    } catch (e) {
      setMessage({ error: true, text: e.message });
    }
  };
  const create = () => {
    const goal = ethers.parseEther(form.goal);
    const amounts = form.milestones.map((m) => ethers.parseEther(m.amount));
    if (amounts.reduce((a, b) => a + b, 0n) > goal)
      throw Error("ยอดรวม Milestone ต้องไม่เกินเป้าหมาย");
    return transaction((c) =>
      c.createCampaign(
        form.title,
        form.description,
        goal,
        Math.round(Number(form.days) * 86400),
        form.milestones.map((m) => m.title),
        amounts,
      ),
    );
  };
  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      if (!account) throw Error("เชื่อมต่อ Wallet ก่อน");
      if (
        !form.title.trim() ||
        !Number(form.goal) ||
        !Number(form.days) ||
        form.milestones.some((m) => !m.title.trim() || !Number(m.amount))
      )
        throw Error("กรุณากรอกข้อมูลให้ครบ");
      await create();
      setForm(initial);
    } catch (e) {
      setMessage({ error: true, text: e.message });
    }
  };
  const card = (c) => (
    <button className="campaign" key={c.id} onClick={() => openCampaign(c.id)}>
      <div className="cover">
        <div className="cover-icon">
          <Coins size={29} />
        </div>
        <span className="cover-id">PROJECT #{c.id}</span>
      </div>
      <div className="campaign-body">
        <div className="tag">
          {now / 1000 < Number(c.deadline)
            ? c.raised >= c.goal
              ? "ถึงเป้าหมายแล้ว"
              : "กำลังระดมทุน"
            : c.raised >= c.goal
              ? "ระดมทุนสำเร็จ"
              : "ไม่ถึงเป้าหมาย"}
        </div>
        <h3>{c.title}</h3>
        <p className="muted clamp">
          {c.description || "โครงการระดมทุนเพื่อสร้างนวัตกรรม"}
        </p>
        <div className="between">
          <b>{eth(c.raised)} ETH</b>
          <span className="muted">จาก {eth(c.goal)} ETH</span>
        </div>
        <div className="progress">
          <div
            style={{
              width: `${Math.min(100, (Number(c.raised) * 100) / Math.max(Number(c.goal), 1))}%`,
            }}
          />
        </div>
        <div className="between small muted">
          <span>
            {Math.round((Number(c.raised) * 100) / Math.max(Number(c.goal), 1))}
            % ของเป้าหมาย
          </span>
          <span>
            {remainingTime(c.deadline, now)}
          </span>
        </div>
      </div>
    </button>
  );
  const stats = [
    { name: "โครงการทั้งหมด", value: campaigns.length, icon: LayoutDashboard },
    {
      name: "เงินสนับสนุนเข้า",
      value: `${eth(campaigns.reduce((sum, campaign) => sum + campaign.raised, 0n))} ETH`,
      icon: Coins,
    },
    {
      name: "จ่ายให้เจ้าของโครงการ",
      value: `${eth(campaigns.reduce((sum, campaign) => sum + campaign.released, 0n))} ETH`,
      icon: ArrowRight,
    },
    {
      name: "คืนให้ผู้สนับสนุน",
      value: `${eth(campaigns.reduce((sum, campaign) => sum + campaign.refunded, 0n))} ETH`,
      icon: History,
    },
    {
      name: "โครงการที่สำเร็จ",
      value: campaigns.filter(
        (campaign) =>
          campaign.raised >= campaign.goal && now / 1000 >= Number(campaign.deadline),
      ).length,
      icon: CheckCircle2,
    },
  ];
  return (
    <div className="shell">
      <aside className={`sidebar ${mobile ? "show" : ""}`}>
        <div
          className="brand"
          onClick={() => {
            setTab("dashboard");
            setMobile(false);
          }}
        >
          <div className="brand-mark">
            <Coins size={23} />
          </div>
          <div>
            <strong>CommonFund</strong>
            <small>PROJECT FINANCE</small>
          </div>
        </div>
        <div className="side-label">FUNDING DESK</div>
        <nav>
          {navigation.map((n) => (
            <button
              key={n.id}
              className={`nav ${tab === n.id ? "active" : ""}`}
              onClick={() => {
                setTab(n.id);
                setMobile(false);
              }}
            >
              <n.icon size={19} />
              {n.label}
            </button>
          ))}
        </nav>
        <div className="side-bottom">
          <div className="network">
            <span className="dot" />
            Ethereum Sepolia
          </div>
          <p>โปร่งใส ตรวจสอบได้ ด้วย Smart Contract</p>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <button className="hamburger" onClick={() => setMobile(!mobile)}>
            <Menu />
          </button>
          <div className="crumb">
            CommonFund <span>/</span>{" "}
            <b>
              {navigation.find((n) => n.id === tab)?.label ||
                "รายละเอียดโครงการ"}
            </b>
          </div>
          <div className="top-actions">
            <div className="role-chip">
              <ShieldCheck size={15} />
              {roles.join(" · ")}
            </div>
            <button className="wallet" onClick={connect}>
              <Wallet size={17} />
              {account ? short(account) : "เชื่อมต่อ MetaMask"}
            </button>
          </div>
        </header>
        <div className="content">
          {!ADDRESS || !readProvider ? (
            <div className="notice">
              <AlertCircle size={20} /> ยังไม่ได้ตั้งค่า .env กรุณากำหนด
              VITE_CONTRACT_ADDRESS และ VITE_INFURA_PROJECT_ID ตาม README
            </div>
          ) : null}
          {message && (
            <div className={`notice ${message.error ? "error" : "success"}`}>
              <AlertCircle size={18} />
              <span>{message.text}</span>
              <button onClick={() => setMessage(null)}>×</button>
            </div>
          )}
          {tab === "dashboard" && (
            <>
              <section className="hero">
                <div>
                  <span className="eyebrow">
                    A MORE ACCOUNTABLE WAY TO FUND
                  </span>
                  <h1>
                    ไอเดียดี เติบโต
                    <br />
                    <em>ด้วยความไว้ใจ</em>
                  </h1>
                  <p>
                    ทุกยอดสนับสนุนมีที่มา ทุกการเบิกจ่ายผูกกับผลงานที่ตรวจสอบได้
                  </p>
                  <button className="primary" onClick={() => setTab("explore")}>
                    สำรวจโครงการ <ArrowRight size={17} />
                  </button>
                </div>
                <div className="hero-art">
                  <Coins size={110} strokeWidth={1} />
                </div>
              </section>
              <div className="stat-grid">
                {stats.map((s) => (
                  <div className="stat" key={s.name}>
                    <div className="stat-icon">
                      <s.icon size={22} />
                    </div>
                    <p>{s.name}</p>
                    <strong>{s.value}</strong>
                  </div>
                ))}
              </div>
              <div className="dashboard-panels">
                <section className="panel ledger-panel">
                  <div className="between dashboard-panel-head">
                    <div>
                      <span className="eyebrow">ON-CHAIN ACTIVITY</span>
                      <h2>บัญชีเงินเข้า–ออก</h2>
                      <p className="muted small">
                        Event ล่าสุดจากทุกโครงการ · ย้อนหลัง 9,000 บล็อก
                      </p>
                    </div>
                    <button className="outline" onClick={load}>
                      <RefreshCw size={16} /> อัปเดต
                    </button>
                  </div>
                  <div className="ledger-list">
                    {dashboardEvents.map((entry, index) => {
                      const event = entry.event;
                      const projectId = Number(event.args[0]);
                      const project = campaigns.find((campaign) => campaign.id === projectId);
                      const amount = eventAmount(event);
                      const financial = ["Contributed", "FundsReleased", "Refunded"].includes(event.name);
                      return (
                        <div className="ledger-row" key={`${entry.hash}-${index}`}>
                          <span className={`ledger-mark ${event.name === "Contributed" ? "in" : event.name === "FundsReleased" || event.name === "Refunded" ? "out" : "record"}`}>
                            {event.name === "Contributed" ? "+" : event.name === "FundsReleased" || event.name === "Refunded" ? "−" : "·"}
                          </span>
                          <div className="ledger-copy">
                            <strong>{eventLabel(event)}</strong>
                            <span className="muted small">
                              #{projectId} {project?.title || "โครงการ"}
                              {event.name === "ReleaseRequested" ? ` · Milestone ${Number(event.args[1]) + 1}` : ""}
                              {event.name === "Voted" ? ` · Milestone ${Number(event.args[1]) + 1}` : ""}
                              {` · Block ${entry.blockNumber}`}
                            </span>
                          </div>
                          <div className="ledger-value">
                            {amount !== null && (
                              <strong className={financial ? (event.name === "Contributed" ? "positive" : "negative") : ""}>
                                {event.name === "Contributed" ? "+" : financial ? "−" : event.name === "Voted" ? "น้ำหนัก " : ""}{eth(amount)} ETH
                              </strong>
                            )}
                            {event.name === "CampaignCreated" && (
                              <strong>เป้าหมาย {eth(event.args[3])} ETH</strong>
                            )}
                            <a href={`https://sepolia.etherscan.io/tx/${entry.hash}`} target="_blank" rel="noreferrer">
                              {short(entry.hash)} <ExternalLink size={12} />
                            </a>
                          </div>
                        </div>
                      );
                    })}
                    {!dashboardEvents.length && (
                      <p className="empty compact">
                        ยังไม่มี Event ในช่วงบล็อกที่ตรวจสอบ
                      </p>
                    )}
                  </div>
                </section>
                <section className="panel milestone-board">
                  <div className="dashboard-panel-head">
                    <span className="eyebrow">DELIVERY TRACKER</span>
                    <h2>สถานะ Milestone</h2>
                    <p className="muted small">
                      แสดง {overviewMilestones.length} จาก {campaigns.length} โครงการล่าสุด
                    </p>
                  </div>
                  <div className="milestone-board-list">
                    {overviewMilestones.map((project) => (
                      <div className="overview-project" key={project.id}>
                        <button className="link overview-project-title" onClick={() => openCampaign(project.id)}>
                          <span>#{project.id} {project.title}</span>
                          <ArrowRight size={14} />
                        </button>
                        {project.milestones.map((milestone) => (
                          <div className="overview-milestone" key={milestone.index}>
                            <span className="muted">
                              {milestone.index + 1}. {milestone.title}
                            </span>
                            <span className={`milestone-state ${milestone.status === "จ่ายแล้ว" ? "done" : milestone.status === "กำลังเปิดโหวต" ? "voting" : "waiting"}`}>
                              {milestone.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                    {overviewLoading && <p className="muted small">กำลังอ่านสถานะจาก Smart Contract…</p>}
                    {!overviewLoading && !overviewMilestones.length && (
                      <p className="muted small">ยังไม่มีโครงการให้แสดงสถานะ</p>
                    )}
                    {!overviewLoading && overviewMilestones.length < campaigns.length && (
                      <button
                        className="outline full"
                        onClick={() => setOverviewLimit((limit) => limit + 8)}
                      >
                        โหลดอีก 8 โครงการ
                      </button>
                    )}
                  </div>
                </section>
              </div>
              <div className="section-head">
                <div>
                  <h2>โครงการล่าสุด</h2>
                  <p className="muted">ร่วมสนับสนุนไอเดียที่คุณเชื่อมั่น</p>
                </div>
                <button className="link" onClick={() => setTab("explore")}>
                  ดูทั้งหมด <ArrowRight size={16} />
                </button>
              </div>
              <div className="cards">{campaigns.slice(0, 3).map(card)}</div>
            </>
          )}
          {["explore", "mine", "backed"].includes(tab) && (
            <>
              <div className="page-head">
                <div>
                  <span className="eyebrow">CAMPAIGNS</span>
                  <h1>
                    {tab === "mine"
                      ? "โครงการของฉัน"
                      : tab === "backed"
                        ? "การสนับสนุนของฉัน"
                        : "สำรวจโครงการ"}
                  </h1>
                  <p className="muted">
                    {tab === "explore"
                      ? "เลือกสนับสนุนโครงการที่คุณสนใจ"
                      : tab === "mine"
                        ? "จัดการและติดตามโครงการที่คุณสร้าง"
                        : "ติดตามโครงการที่คุณได้สนับสนุน"}
                  </p>
                </div>
                <button className="outline" onClick={load}>
                  <RefreshCw size={17} /> รีเฟรช
                </button>
              </div>
              <div className="cards">
                {(tab === "mine"
                  ? owned
                  : tab === "backed"
                    ? backed
                    : campaigns
                ).map(card)}
              </div>
              {!(tab === "mine" ? owned : tab === "backed" ? backed : campaigns)
                .length && (
                <div className="empty">
                  {loading ? "กำลังโหลดข้อมูล..." : "ยังไม่มีโครงการในหมวดนี้"}
                </div>
              )}
            </>
          )}
          {tab === "create" && (
            <>
              <div className="page-head">
                <div>
                  <span className="eyebrow">NEW CAMPAIGN</span>
                  <h1>สร้างโครงการระดมทุน</h1>
                  <p className="muted">
                    กำหนดเป้าหมาย ระยะเวลา และแผนการเบิกจ่าย
                  </p>
                </div>
              </div>
              <form className="panel form" onSubmit={handleCreate}>
                <label>
                  ชื่อโครงการ
                  <input
                    required
                    value={form.title}
                    onChange={(e) =>
                      setForm({ ...form, title: e.target.value })
                    }
                    placeholder="เช่น Smart Farming IoT"
                  />
                </label>
                <label>
                  รายละเอียดโครงการ
                  <textarea
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                    rows="4"
                    placeholder="อธิบายแนวคิดและเป้าหมาย"
                  />
                </label>
                <div className="two">
                  <label>
                    เป้าหมาย (ETH)
                    <input
                      type="number"
                      min="0.000000000000000001"
                      step="any"
                      required
                      value={form.goal}
                      onChange={(e) =>
                        setForm({ ...form, goal: e.target.value })
                      }
                      placeholder="1.0"
                    />
                  </label>
                  <label>
                    ระยะเวลาระดมทุน (วัน)
                    <input
                      type="number"
                      min="1"
                      max="365"
                      required
                      value={form.days}
                      onChange={(e) =>
                        setForm({ ...form, days: e.target.value })
                      }
                    />
                  </label>
                </div>
                <div className="between">
                  <h3>Milestones</h3>
                  <button
                    type="button"
                    className="link"
                    disabled={form.milestones.length >= 20}
                    onClick={() =>
                      setForm({
                        ...form,
                        milestones: [
                          ...form.milestones,
                          { title: "", amount: "" },
                        ],
                      })
                    }
                  >
                    + เพิ่ม Milestone
                  </button>
                </div>
                {form.milestones.map((m, i) => (
                  <div className="milestone-input" key={i}>
                    <span className="number">{i + 1}</span>
                    <input
                      aria-label="ชื่อ Milestone"
                      required
                      placeholder="ชื่อระยะงาน"
                      value={m.title}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          milestones: form.milestones.map((v, j) =>
                            j === i ? { ...v, title: e.target.value } : v,
                          ),
                        })
                      }
                    />
                    <input
                      aria-label="จำนวน ETH"
                      type="number"
                      min="0.000000000000000001"
                      step="any"
                      required
                      placeholder="จำนวน ETH"
                      value={m.amount}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          milestones: form.milestones.map((v, j) =>
                            j === i ? { ...v, amount: e.target.value } : v,
                          ),
                        })
                      }
                    />
                    {form.milestones.length > 1 && (
                      <button
                        type="button"
                        className="remove"
                        onClick={() =>
                          setForm({
                            ...form,
                            milestones: form.milestones.filter(
                              (_, j) => j !== i,
                            ),
                          })
                        }
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                <p className="muted small">
                  ยอดรวม Milestones ต้องไม่เกินเป้าหมาย
                  เงินที่เหลือจะยังอยู่ในสัญญา
                </p>
                <button className="primary" disabled={busy || !account}>
                  {busy ? "กำลังทำธุรกรรม..." : "สร้างโครงการบน Blockchain"}{" "}
                  <ArrowRight size={17} />
                </button>
                {!account && (
                  <p className="muted small">
                    เชื่อมต่อ Wallet เพื่อสร้างโครงการ
                  </p>
                )}
              </form>
            </>
          )}
          {tab === "detail" && selected && (
            <>
              <button className="link back" onClick={() => setTab("explore")}>
                ← กลับไปสำรวจโครงการ
              </button>
              <div className="detail-head">
                <div>
                  <span className="eyebrow">PROJECT #{selected.id}</span>
                  <h1>{selected.title}</h1>
                  <p className="muted">{selected.description}</p>
                  <p className="small muted">
                    เจ้าของโครงการ: {short(selected.creator)} · สิ้นสุด{" "}
                    {fmtDate(selected.deadline)} · {remainingTime(selected.deadline, now)}
                  </p>
                </div>
              </div>
              <div className="detail-grid">
                <div>
                  <div className="panel">
                    <div className="between">
                      <h2>ความคืบหน้าการระดมทุน</h2>
                      <span className="tag">
                        {now / 1000 < Number(selected.deadline)
                          ? selected.raised >= selected.goal
                            ? "ถึงเป้าหมายแล้ว"
                            : "เปิดระดมทุน"
                          : "ปิดระดมทุน"}
                      </span>
                    </div>
                    <div className="big-number">
                      {eth(selected.raised)} <span>ETH</span>
                    </div>
                    <p className="muted">เป้าหมาย {eth(selected.goal)} ETH</p>
                    <div className="progress large">
                      <div
                        style={{
                          width: `${Math.min(100, (Number(selected.raised) * 100) / Math.max(Number(selected.goal), 1))}%`,
                        }}
                      />
                    </div>
                    <div className="between small muted">
                      <span>จ่ายแล้ว {eth(selected.released)} ETH</span>
                      <span>คืนแล้ว {eth(selected.refunded)} ETH</span>
                    </div>
                  </div>
                  <div className="panel">
                    <h2>แผนงานและการอนุมัติ</h2>
                    {detail?.ms.map((m, i) => {
                      const owner = same(account, selected.creator),
                        canRequest =
                          owner &&
                          now / 1000 >= Number(selected.deadline) &&
                          selected.raised >= selected.goal &&
                          !m.requested &&
                          (i === 0 || detail.ms[i - 1].paid);
                      const canVote =
                        BigInt(detail.mine) > 0n &&
                        m.requested &&
                        !m.paid &&
                        now / 1000 < Number(m.voteDeadline) &&
                        !detail.votes[i];
                      const canRelease =
                        m.requested &&
                        !m.paid &&
                        now / 1000 >= Number(m.voteDeadline) &&
                        m.approvals > m.votingPowerSnapshot / 2;
                      return (
                        <div className="milestone" key={i}>
                          <div className="between">
                            <h3>
                              <span className="number">{i + 1}</span>
                              {m.title}
                            </h3>
                            <span className="tag">
                              {m.paid
                                ? "จ่ายแล้ว"
                                : m.requested
                                  ? "รอลงคะแนน"
                                  : "ยังไม่ส่งงาน"}
                            </span>
                          </div>
                          <p className="muted small">
                            จัดสรร {eth(m.amount)} ETH
                          </p>
                          {m.requested && (
                            <>
                              <p className="small">
                                หลักฐาน:{" "}
                                <a
                                  href={
                                    /^https:\/\//i.test(m.evidence)
                                      ? m.evidence
                                      : undefined
                                  }
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {m.evidence}
                                </a>
                              </p>
                              <p className="muted small">
                                เห็นชอบ {eth(m.approvals)} ETH · ไม่เห็นชอบ{" "}
                                {eth(m.rejections)} ETH
                              </p>
                              <p className="muted small">
                                ปิดโหวต {fmtDate(m.voteDeadline)} ·
                                ต้องได้เสียงเห็นชอบมากกว่า 50% ของเงินระดมทุน
                              </p>
                            </>
                          )}
                          {canRequest && (
                            <div className="action-row">
                              <input
                                placeholder="URL หลักฐานงาน (https://...)"
                                value={evidence[i] || ""}
                                onChange={(e) =>
                                  setEvidence({
                                    ...evidence,
                                    [i]: e.target.value,
                                  })
                                }
                              />
                              <button
                                disabled={busy || !evidence[i]?.trim()}
                                className="primary"
                                onClick={() =>
                                  transaction((c) =>
                                    c.requestRelease(
                                      selected.id,
                                      i,
                                      evidence[i],
                                    ),
                                  )
                                }
                              >
                                ขอเบิก
                              </button>
                            </div>
                          )}
                          {canVote && (
                            <div className="action-row">
                              <button
                                disabled={busy}
                                className="primary"
                                onClick={() =>
                                  transaction((c) =>
                                    c.vote(selected.id, i, true),
                                  )
                                }
                              >
                                <Vote size={16} /> เห็นชอบ
                              </button>
                              <button
                                disabled={busy}
                                className="outline"
                                onClick={() =>
                                  transaction((c) =>
                                    c.vote(selected.id, i, false),
                                  )
                                }
                              >
                                ไม่เห็นชอบ
                              </button>
                            </div>
                          )}
                          {canRelease && (
                            <button
                              className="primary"
                              disabled={busy}
                              onClick={() =>
                                transaction((c) => c.release(selected.id, i))
                              }
                            >
                              ดำเนินการจ่ายเงิน
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="panel">
                    <h2>
                      <History size={19} /> ประวัติธุรกรรมล่าสุด
                    </h2>
                    <p className="muted small">
                      อ่าน Event จากเครือข่ายย้อนหลังประมาณ 9,000 บล็อก
                      (ไม่ใช่ประวัติทั้งหมด)
                    </p>
                    {events.map((e, i) => (
                      <div className="event" key={i}>
                        <span>
                          {
                            {
                              Contributed: "สนับสนุนเงิน",
                              ReleaseRequested: "ขอเบิกเงิน",
                              Voted: "ลงคะแนน",
                              FundsReleased: "จ่ายเงิน",
                              Refunded: "คืนเงิน",
                            }[e.event.name]
                          }
                        </span>
                        <a
                          target="_blank"
                          rel="noreferrer"
                          href={`https://sepolia.etherscan.io/tx/${e.hash}`}
                        >
                          {short(e.hash)} <ExternalLink size={13} />
                        </a>
                      </div>
                    ))}
                    {!events.length && (
                      <p className="muted small">
                        ไม่พบธุรกรรมในช่วงบล็อกที่ตรวจสอบ
                      </p>
                    )}
                  </div>
                </div>
                <div>
                  <div className="panel sticky">
                    <h2>สนับสนุนโครงการ</h2>
                    <p className="muted small">
                      เงิน ETH จะถูกเก็บใน Smart Contract
                    </p>
                    {now / 1000 < Number(selected.deadline) &&
                    selected.raised < selected.goal ? (
                      <>
                        <label>
                          จำนวน ETH
                          <input
                            type="number"
                            min="0.000000000000000001"
                            step="any"
                            value={contribute}
                            onChange={(e) => setContribute(e.target.value)}
                          />
                        </label>
                        <button
                          className="primary full"
                          disabled={
                            busy || !account || !(Number(contribute) > 0)
                          }
                          onClick={() =>
                            transaction((c) =>
                              c.contribute(selected.id, {
                                value: ethers.parseEther(contribute),
                              }),
                            )
                          }
                        >
                          สนับสนุน {contribute} ETH
                        </button>
                      </>
                    ) : (
                      <p className="muted">
                        {now / 1000 < Number(selected.deadline)
                          ? "ถึงเป้าหมายการระดมทุนแล้ว"
                          : "หมดเวลาระดมทุนแล้ว"}
                      </p>
                    )}
                    {account && (
                      <>
                        <hr />
                        <p>
                          คุณสนับสนุนแล้ว <b>{eth(detail?.mine)} ETH</b>
                        </p>
                        {now / 1000 >= Number(selected.deadline) &&
                          selected.raised < selected.goal &&
                          BigInt(detail?.mine || 0) > 0n && (
                            <button
                              className="outline full"
                              disabled={busy}
                              onClick={() =>
                                transaction((c) => c.refund(selected.id))
                              }
                            >
                              ขอคืนเงิน
                            </button>
                          )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
          {tab === "admin" && isAdmin && (
            <>
              <div className="page-head">
                <div>
                  <span className="eyebrow">ADMIN OVERVIEW</span>
                  <h1>ภาพรวมสำหรับผู้ดูแลระบบ</h1>
                  <p className="muted">
                    ตรวจสอบสถานะและยอดระดมทุน โดยไม่มีสิทธิ์ถอนเงินแทนผู้สร้าง
                  </p>
                </div>
              </div>
              <div className="stat-grid">
                {stats.map((s) => (
                  <div className="stat" key={s.name}>
                    <s.icon size={21} />
                    <p>{s.name}</p>
                    <strong>{s.value}</strong>
                  </div>
                ))}
              </div>
              <div className="panel">
                <h2>รายการโครงการทั้งหมด</h2>
                {campaigns.map((c) => (
                  <button
                    className="admin-row"
                    key={c.id}
                    onClick={() => openCampaign(c.id)}
                  >
                    <span>
                      #{c.id} {c.title}
                    </span>
                    <span>
                      {eth(c.raised)} ETH <ArrowRight size={15} />
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          <footer>
            CommonFund · Ethereum Sepolia Testnet · ใช้เฉพาะ ETH ทดสอบ
          </footer>
        </div>
      </main>
    </div>
  );
}
export default App;
