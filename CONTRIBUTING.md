# Contributing to RIFI

Thank you for your interest in contributing to RIFI! This document provides guidelines and instructions for contributing to this AI-native autonomous trading agent on Base.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Contributing Guidelines](#contributing-guidelines)
- [Submitting Changes](#submitting-changes)
- [Smart Contract Security](#smart-contract-security)
- [Community](#community)

## Code of Conduct

This project adheres to a standard of professional conduct. By participating, you agree to:

- Be respectful and inclusive in all interactions
- Provide constructive feedback
- Focus on what's best for the community and users
- Show empathy towards others

## Getting Started

### Prerequisites

Before contributing, please ensure you have:

- **Node.js** (v18 or higher)
- **Foundry** for smart contract development
- **Git** for version control
- A **Web3 wallet** (MetaMask, Coinbase Wallet, etc.) with Base network configured
- Basic understanding of:
  - Solidity smart contracts
  - React/Next.js (for frontend)
  - Reactive Network concepts

### Repository Structure

```
RIFI/
├── src/                    # Smart contract source code
├── script/                 # Deployment and interaction scripts
├── web/                    # Frontend application
├── vps-api/                # VPS API services
├── docs/                   # Documentation
│   ├── ARCHITECTURE.md     # System architecture
│   ├── ARCHITECTURE-CN.md  # Chinese architecture docs
│   ├── DEMO-SCRIPT.md      # Demo walkthrough
│   ├── ROADMAP-V2.md       # Future roadmap
│   └── TODO.md             # Pending tasks
├── lib/                    # Dependencies
├── foundry.toml            # Foundry configuration
└── deploy.sh               # Deployment script
```

## Development Setup

### 1. Clone the Repository

```bash
git clone https://github.com/enderzcx/RIFI.git
cd RIFI
```

### 2. Install Dependencies

```bash
# Install Foundry dependencies
forge install

# Install Node.js dependencies for web
npm install
```

### 3. Environment Configuration

Create a `.env` file in the root directory:

```env
# Required for contract deployment
PRIVATE_KEY=your_private_key_here
BASE_RPC_URL=https://mainnet.base.org
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
REACTIVE_RPC_URL=https://kopli-rpc.rnk.dev

# Required for VPS API (if running full stack)
OPENAI_API_KEY=your_openai_key_here
COINGECKO_API_KEY=your_coingecko_key_here
```

### 4. Compile Contracts

```bash
forge build
```

### 5. Run Tests

```bash
forge test
```

## Contributing Guidelines

### Types of Contributions

We welcome the following types of contributions:

1. **Bug Fixes**: Fix issues in smart contracts or frontend
2. **Feature Enhancements**: Add new trading strategies or UI improvements
3. **Documentation**: Improve README, architecture docs, or code comments
4. **Testing**: Add test coverage for contracts and features
5. **Security Audits**: Review contracts for vulnerabilities
6. **Performance Optimizations**: Gas optimizations, API improvements

### Smart Contract Changes

When modifying smart contracts:

1. **Add comprehensive tests** for new functionality
2. **Document gas costs** for new functions
3. **Follow Solidity style guide** (NatSpec comments, consistent naming)
4. **Consider upgradeability** implications
5. **Test on Base Sepolia** before mainnet

### Frontend Changes

When modifying the web application:

1. **Maintain responsive design** for mobile and desktop
2. **Test wallet connections** with multiple providers
3. **Ensure accessibility** (ARIA labels, keyboard navigation)
4. **Follow existing code style** and component patterns

### Documentation Changes

When updating documentation:

1. **Keep ARCHITECTURE.md in sync** with code changes
2. **Update contract addresses** if deployments change
3. **Add examples** for complex features
4. **Maintain both English and Chinese** docs when applicable

## Submitting Changes

### Pull Request Process

1. **Fork the repository** and create your branch from `main`
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following the guidelines above

3. **Test thoroughly**:
   ```bash
   # Run contract tests
   forge test
   
   # Check code formatting
   forge fmt --check
   ```

4. **Commit with clear messages**:
   ```bash
   git commit -m "feat: add stop-loss validation for volatile pairs"
   ```

5. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Open a Pull Request** with:
   - Clear description of changes
   - Link to related issues
   - Screenshots for UI changes
   - Test results

### Commit Message Format

We follow conventional commits:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation only
- `style:` Code style (formatting, semicolons)
- `refactor:` Code refactoring
- `test:` Adding or updating tests
- `chore:` Build process, dependencies

Example:
```
feat: add support for multi-hop swaps in stop-loss

- Implement path validation for Uniswap V2
- Add slippage protection for intermediate tokens
- Update tests for new swap logic
```

## Smart Contract Security

### Security Checklist

Before submitting smart contract changes:

- [ ] Re-entrancy guards in place for external calls
- [ ] Integer overflow/underflow protection (Solidity 0.8+)
- [ ] Access control for admin functions
- [ ] Input validation for all public functions
- [ ] Events emitted for state changes
- [ ] No hardcoded secrets or private keys
- [ ] Gas optimization considered

### Reporting Security Issues

**DO NOT** open public issues for security vulnerabilities.

Instead:
1. Email security concerns to the maintainers privately
2. Allow time for assessment and fix
3. Coordinate disclosure timeline

## Testing

### Contract Testing

```bash
# Run all tests
forge test

# Run with verbosity
forge test -vvv

# Run specific test
forge test --match-test testStopLossExecution

# Run with gas report
forge test --gas-report
```

### Frontend Testing

```bash
cd web
npm test
```

### Integration Testing

Test the full flow on Base Sepolia:

1. Deploy contracts to Sepolia
2. Test Session Key creation
3. Verify stop-loss execution
4. Check Reactive Network callbacks

## Deployment

### Testnet Deployment

```bash
# Deploy to Base Sepolia
forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast

# Deploy to Reactive Testnet
forge script script/DeployReactive.s.sol --rpc-url $REACTIVE_RPC_URL --broadcast
```

### Mainnet Deployment

**Only maintainers** deploy to mainnet. Changes must:
- Pass all tests
- Undergo security review
- Be approved by maintainers

## Community

### Getting Help

- **GitHub Issues**: Bug reports and feature requests
- **Demo Site**: Try the live demo at [enderzcxai.duckdns.org](https://enderzcxai.duckdns.org)
- **Documentation**: Check [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for system details

### Resources

- [Base Documentation](https://docs.base.org)
- [Reactive Network Docs](https://reactive.network)
- [Foundry Book](https://book.getfoundry.sh)
- [Uniswap V2 Docs](https://docs.uniswap.org/contracts/v2)

## Recognition

Contributors will be recognized in:
- Release notes
- README contributors section
- Project documentation

Thank you for helping make RIFI better! 🚀
