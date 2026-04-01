# Contributing to RIFI

Thank you for your interest in contributing to RIFI (Reactive Intelligence for Financial Instruments)! This guide will help you get started with our AI-native autonomous trading agent on Base.

## Code of Conduct

- Be respectful and constructive in all interactions
- Prioritize security, especially for Session Key handling
- Test thoroughly on testnets before mainnet
- Document your changes clearly

## Getting Started

### Prerequisites

- **Foundry** - For smart contract development
- **Node.js 18+** - For the API and web frontend
- **Git** - For version control
- **Reactive Network access** - For testing Reactive Smart Contracts

### Installation

```bash
# Clone the repository
git clone https://github.com/enderzcx/RIFI.git
cd RIFI

# Install contract dependencies
forge install

# Install Node.js dependencies for API
cd vps-api
npm install

# Install Node.js dependencies for web
cd ../web
npm install
```

## Project Structure

```
RIFI/
├── src/                    # Solidity smart contracts
│   ├── ReactiveStopLoss.sol    # Reactive stop-loss implementation
│   └── ...
├── script/                 # Deployment scripts
├── test/                   # Foundry tests
├── vps-api/               # Node.js API server
│   └── index.mjs          # Main API entry point
└── web/                   # React frontend
    └── ...
```

## Development Workflow

### Branch Naming

- `feat/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation
- `security/description` - Security fixes
- `reactive/description` - Reactive Network related

### Commit Messages

Follow conventional commits:
```
feat: add take-profit order type to Reactive contracts
fix: correct price feed validation in stop-loss
reactive: optimize callback gas usage
docs: add Session Key integration guide
```

## Coding Standards

### Solidity (Smart Contracts)

- Use Solidity ^0.8.19
- Follow NatSpec documentation standards
- All external functions must have reentrancy guards
- Validate all inputs (addresses, amounts, deadlines)
- Reactive callbacks must be gas-efficient

### JavaScript/Node.js (API)

- Use ES modules (.mjs)
- Async/await for asynchronous operations
- Proper error handling with try/catch
- Input validation on all endpoints
- Never log private keys or Session Key data

### React (Frontend)

- Functional components with hooks
- Proper wallet connection handling
- Clear error messages for users
- Loading states for all async operations

## Testing

### Smart Contract Tests

```bash
# Run all tests
forge test

# Run with gas report
forge test --gas-report

# Run specific test
forge test --match-test testStopLossExecution
```

### API Tests

```bash
cd vps-api
npm test
```

### Integration Testing

1. Deploy contracts to Base Sepolia
2. Configure Reactive Network subscriptions
3. Test Session Key flow end-to-end
4. Verify stop-loss execution

## Areas for Contribution

### High Priority

- **Additional Order Types** - Take-profit, trailing stop, limit orders
- **Multi-Token Support** - Support for more DEXes and token pairs
- **Gas Optimization** - Reduce gas costs for Reactive callbacks
- **Security Audits** - Formal verification of critical paths

### Medium Priority

- **Frontend Improvements** - Better UX for Session Key management
- **Monitoring Dashboard** - Real-time order tracking
- **Documentation** - Integration guides for other AI agents
- **Test Coverage** - Increase test coverage to 90%+

### Research

- **Cross-chain Orders** - Execute orders across L2s
- **MEV Protection** - Protect user orders from frontrunning
- **AI Strategy Modules** - Pluggable trading strategies

## Security Considerations

**Critical: Session Key Security**

- Never commit Session Keys to git
- Always validate Session Key permissions
- Implement proper key rotation
- Log all Session Key operations

**Smart Contract Security**

- All state-changing functions need access control
- Price oracle manipulation protection
- Reentrancy guards on all external calls
- Emergency pause functionality

## Submitting Changes

1. **Fork** the repository
2. **Create a branch** for your feature
3. **Write tests** for new functionality
4. **Test on Base Sepolia** before submitting
5. **Update documentation** if needed
6. **Submit a Pull Request**

### PR Requirements

- Clear description of changes
- Link to any related issues
- Test results (all tests passing)
- Gas impact analysis for contract changes
- Security considerations documented

## Security Disclosures

**Do NOT open public issues for security vulnerabilities.**

Email: security@rifi.xyz (or DM maintainer on Twitter/X)

Include:
- Vulnerability description
- Steps to reproduce
- Potential impact
- Suggested fix

We follow responsible disclosure.

## Questions?

- Open a GitHub Discussion
- Join the Reactive Network Discord
- Follow updates on Twitter/X

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Let's build the future of AI-powered DeFi together!** 🤖⚡
