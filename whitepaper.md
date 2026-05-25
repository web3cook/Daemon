# SIP Protocol: Non-Custodial On-Chain Systematic Investment Plans

**Version:** 0.1 — Draft  
**Date:**  
**Status:** Pre-release

---

## Abstract

---

## 1. Introduction

### 1.1 The DCA Thesis

### 1.2 Why Crypto Is Different

### 1.3 The Gap in the Market

---

## 2. Problem Statement

### 2.1 The Custodial Trap

### 2.2 The Manual Execution Problem

### 2.3 The Missing On-Chain Primitive

---

## 3. The SIP Protocol

### 3.1 Vision

### 3.2 Design Principles

- Non-custodial by construction
- Permissionless and transparent
- Extensible beyond DCA
- User-controlled and cancellable at any time

### 3.3 What SIP Is Not

---

## 4. How It Works

### 4.1 Protocol Overview

### 4.2 The Subscription Lifecycle

1. User approves token spend
2. User calls `subscribe()` with parameters
3. Bot monitors and executes at each interval
4. Bought tokens land directly in user's wallet
5. User cancels at any time via `cancel()`

### 4.3 The Execution Model

### 4.4 Price Aggregation

### 4.5 Fund Flow Diagram

```
User Wallet → Subscriptions Contract (transient) → SIPService → Aggregator → User Wallet
```

---

## 5. Smart Contract Architecture

### 5.1 Subscriptions.sol

### 5.2 SIPService.sol

### 5.3 IService Interface

### 5.4 Extensibility: Beyond DCA

---

## 6. Security Model

### 6.1 Non-Custodial Guarantees

### 6.2 Access Controls

### 6.3 What the Bot Can and Cannot Do

### 6.4 Risk Vectors and Mitigations

| Risk | Mitigation |
|------|------------|
| | |

### 6.5 Audits

---

## 7. Supported Assets and Chains

### 7.1 Supported Spend Tokens

### 7.2 Supported Buy Tokens

### 7.3 Supported Chains

### 7.4 Whitelisting Policy

---

## 8. Simulation and Transparency

### 8.1 Historical DCA Simulator

### 8.2 DCA vs. Lump-Sum Comparison

### 8.3 On-Chain Execution History

---

## 9. Fee Structure

### 9.1 Protocol Fee

### 9.2 Gas Cost Model

### 9.3 Aggregator Fee

### 9.4 No Hidden Costs

---

## 10. Competitive Landscape

| Protocol | Custodial | On-Chain | Non-Custodial | Open Source |
|----------|-----------|----------|----------------|-------------|
| SIP | | | | |
| | | | | |

---

## 11. Roadmap

### Phase 1 — Foundation

### Phase 2 — Mainnet

### Phase 3 — Expansion

---

## 12. Team

---

## 13. Conclusion

---

## Appendix A: Contract Interface Reference

```solidity
interface IService {
    function execute(
        address subscriber,
        address spendToken,
        uint256 amount,
        bytes calldata params
    ) external returns (bool);
}
```

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| SIP | Systematic Investment Plan |
| DCA | Dollar-Cost Averaging |
| EOA | Externally Owned Account |
| DEX | Decentralized Exchange |

## Appendix C: References
