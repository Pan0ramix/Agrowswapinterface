# Trading API Backend Implementation Checklist

## 1. Environment Setup

### Frontend Configuration
- [ ] Create `.env` file in `apps/web/` directory
- [ ] Set `REACT_APP_TRADING_API_URL_OVERRIDE=https://your-backend-api.com`
- [ ] Set `REACT_APP_TRADING_API_URL_OVERRIDE` to your backend URL (e.g., `http://localhost:8080`)
- [ ] Optional: Set `REACT_APP_ENTRY_GATEWAY_API_URL_OVERRIDE` if using entry gateway
- [ ] Restart development server after setting environment variables

### Backend Server Requirements
- [ ] Choose backend framework (Node.js/Express, Python/FastAPI, Go, etc.)
- [ ] Set up HTTP server with POST endpoint support
- [ ] Configure CORS to allow requests from your frontend domain
- [ ] Set up HTTPS for production (required for secure transactions)

---

## 2. Required API Endpoints

### Critical Endpoints (Minimum for LP Creation)

#### A. `/v1/lp/approve` (POST)
**Purpose**: Check if tokens need approval and generate approval transactions

**Request Type**: `CheckApprovalLPRequest`
**Response Type**: `CheckApprovalLPResponse`

**Key Fields to Handle**:
- `walletAddress` - User's wallet address
- `chainId` - Blockchain network ID
- `protocol` - Protocol version (V2, V3, V4)
- `token0`, `token1` - Token addresses
- `amount0`, `amount1` - Token amounts (as strings)
- `simulateTransaction` - Whether to simulate or return actual calldata
- `generatePermitAsTransaction` - For V4 permit support

**Response Must Include**:
- `token0Approval` - Transaction calldata for token0 approval (if needed)
- `token1Approval` - Transaction calldata for token1 approval (if needed)
- `permitData` - EIP-2612 permit data (if using permits)
- `token0PermitTransaction` - Permit transaction for token0
- `token1PermitTransaction` - Permit transaction for token1
- `gasFeeToken0Approval` - Gas fee estimate for token0 approval
- `gasFeeToken1Approval` - Gas fee estimate for token1 approval

**Implementation Logic**:
1. Check current token allowances for user's wallet
2. Compare with required amounts
3. If insufficient, generate approval transaction calldata
4. Optionally generate permit data (EIP-2612) for gasless approvals
5. Estimate gas fees

---

#### B. `/v1/lp/create` (POST)
**Purpose**: Generate transaction calldata for creating LP position

**Request Type**: `CreateLPPositionRequest`
**Response Type**: `CreateLPPositionResponse`

**Key Fields to Handle**:

**For V2**:
- `protocol` - Must be V2
- `walletAddress` - User's wallet address
- `chainId` - Blockchain network ID
- `independentAmount` - Amount of independent token (as string)
- `independentToken` - Which token is independent (TOKEN_0 or TOKEN_1)
- `defaultDependentAmount` - Expected dependent token amount
- `slippageTolerance` - Slippage percentage
- `position.pool.token0` - Token0 address
- `position.pool.token1` - Token1 address
- `simulateTransaction` - Whether to simulate

**For V3/V4**:
- `protocol` - V3 or V4
- `walletAddress` - User's wallet address
- `chainId` - Blockchain network ID
- `independentAmount` - Amount of independent token
- `independentToken` - Which token is independent
- `defaultDependentAmount` - Expected dependent token amount
- `slippageTolerance` - Slippage percentage
- `position.pool.token0` - Token0 address
- `position.pool.token1` - Token1 address
- `position.pool.fee` - Fee tier (for V3)
- `position.pool.tickSpacing` - Tick spacing
- `position.tickLower` - Lower tick bound
- `position.tickUpper` - Upper tick bound
- `position.hooks` - Hook addresses (for V4)
- `initialPrice` - Initial sqrt price (if creating new pool)
- `simulateTransaction` - Whether to simulate

**Response Must Include**:
- `create` - Transaction request object with:
  - `to` - Contract address (Router/PoolManager)
  - `data` - Transaction calldata (hex string)
  - `value` - ETH value (if native token involved)
  - `chainId` - Chain ID
  - `gas` - Gas limit estimate
- `dependentAmount` - Actual dependent token amount after calculation
- `sqrtRatioX96` - Current pool price (sqrt price * 2^96)
- `gasFee` - Gas fee estimate

**Implementation Logic**:
1. Validate input parameters
2. Calculate dependent token amount based on current pool price
3. Build transaction calldata using your contract's Router/PoolManager
4. Apply slippage tolerance
5. Estimate gas costs
6. Return transaction data

---

### Optional Endpoints (For Full Functionality)

#### C. `/v1/quote` (POST)
**Purpose**: Get swap quotes for token pairs
- Used for calculating dependent amounts in LP positions
- Returns best swap route and pricing

#### D. `/v1/lp/increase` (POST)
**Purpose**: Add more liquidity to existing position
- Similar to create but for existing positions

#### E. `/v1/lp/decrease` (POST)
**Purpose**: Remove liquidity from position
- Calculate amounts to withdraw

#### F. `/v1/lp/claim` (POST)
**Purpose**: Claim accumulated fees
- Generate transaction to claim LP fees

---

## 3. Protocol Buffer Definitions

### Required Packages/Libraries
- [ ] Install Protocol Buffer compiler (`protoc`)
- [ ] Install protobuf library for your backend language:
  - **Node.js**: `@protobuf-ts/protoc` or `protobufjs`
  - **Python**: `protobuf` package
  - **Go**: `google.golang.org/protobuf`
  - **Rust**: `prost` or `protobuf`

### Protocol Buffer Files Location
- [ ] Locate `.proto` files in the codebase (likely in `@uniswap/client-trading` package)
- [ ] Key proto files needed:
  - `trading/v1/api.proto` - Main API definitions
  - `trading/v1/liquidity.proto` - LP-specific messages
  - `trading/v1/approval.proto` - Approval messages

### Type Definitions Reference
- [ ] Check TypeScript types in: `packages/api/src/clients/trading/__generated__/`
- [ ] These show the exact structure of requests/responses
- [ ] Use these as reference for your backend implementation

---

## 4. Request/Response Format

### HTTP Method
- [ ] All endpoints use **POST** method
- [ ] Content-Type: `application/json` or `application/x-protobuf` (check what frontend sends)

### Headers
- [ ] Accept `x-api-key` header (optional, for authentication)
- [ ] Accept `x-universal-router-version` header
- [ ] Accept feature flag headers (can ignore for basic implementation)
- [ ] Set proper CORS headers:
  - `Access-Control-Allow-Origin: *` (or your frontend domain)
  - `Access-Control-Allow-Methods: POST, OPTIONS`
  - `Access-Control-Allow-Headers: Content-Type, x-api-key`

### Request Body
- [ ] Parse JSON request body (or protobuf if using binary)
- [ ] Validate all required fields
- [ ] Handle large number strings (amounts are strings, not numbers)

### Response Format
- [ ] Return JSON response matching TypeScript interface
- [ ] Include all required fields
- [ ] Handle errors with proper HTTP status codes (400, 500, etc.)
- [ ] Return error messages in format: `{ detail: "error message", requestId: "optional-id" }`

---

## 5. Core Functionality Implementation

### Token Approval Logic
- [ ] Connect to blockchain RPC (Infura, Alchemy, or your own node)
- [ ] Read current token allowance: `token.allowance(owner, spender)`
- [ ] Compare with required amount
- [ ] If insufficient, generate approval transaction:
  - Call `token.approve(spender, amount)` or `token.approve(spender, max)`
  - Encode function call to calldata
- [ ] Estimate gas for approval transaction

### LP Position Creation Logic

#### For V2 (Uniswap V2 Router):
- [ ] Use Uniswap V2 Router contract interface
- [ ] Calculate optimal token amounts (respect slippage)
- [ ] Build transaction:
  - `router.addLiquidity(token0, token1, amount0Desired, amount1Desired, amount0Min, amount1Min, to, deadline)`
- [ ] Encode function call to calldata

#### For V3 (NonfungiblePositionManager):
- [ ] Use NonfungiblePositionManager contract
- [ ] Calculate amounts based on tick range and current price
- [ ] Build transaction:
  - `mint(params)` where params includes:
    - `token0`, `token1`
    - `fee` - Fee tier
    - `tickLower`, `tickUpper`
    - `amount0Desired`, `amount1Desired`
    - `amount0Min`, `amount1Min`
    - `recipient`
    - `deadline`
- [ ] Encode function call to calldata

#### For V4 (PoolManager):
- [ ] Use PoolManager contract
- [ ] Handle hook initialization if creating new pool
- [ ] Build transaction using V4's modifyLiquidity or similar
- [ ] Handle permit data if using gasless approvals

### Price Calculation
- [ ] Get current pool price (sqrtPriceX96)
- [ ] Calculate dependent token amount from independent amount
- [ ] Apply slippage tolerance
- [ ] Return calculated amounts

### Gas Estimation
- [ ] Use `eth_estimateGas` RPC call
- [ ] Or use gas estimation libraries
- [ ] Return gas limit and gas price estimates
- [ ] Calculate total gas fee in native token

---

## 6. Blockchain Integration

### RPC Provider Setup
- [ ] Set up connection to blockchain RPC endpoint
- [ ] Support multiple chains (Ethereum, Base, Arbitrum, etc.)
- [ ] Handle rate limiting and retries
- [ ] Use connection pooling for performance

### Contract Addresses
- [ ] Deploy or use existing Router contracts for your protocol
- [ ] Store contract addresses per chain
- [ ] Support both mainnet and testnets

### Contract ABIs
- [ ] Get Router contract ABI
- [ ] Get ERC20 token ABI (for approvals)
- [ ] Get PoolManager/PositionManager ABI (for V3/V4)
- [ ] Use libraries like `ethers.js`, `viem`, or `web3.py` to encode transactions

---

## 7. Error Handling

### Validation Errors (400)
- [ ] Validate wallet address format
- [ ] Validate chain ID is supported
- [ ] Validate token addresses
- [ ] Validate amounts are positive
- [ ] Validate tick ranges (for V3/V4)
- [ ] Return descriptive error messages

### Simulation Errors (400)
- [ ] If `simulateTransaction: true`, simulate the transaction
- [ ] Catch revert reasons
- [ ] Return user-friendly error messages

### Server Errors (500)
- [ ] Handle RPC connection failures
- [ ] Handle timeout errors
- [ ] Log errors for debugging
- [ ] Return generic error message to frontend

### Error Response Format
```json
{
  "detail": "Error message here",
  "requestId": "optional-request-id-for-tracking"
}
```

---

## 8. Security Considerations

- [ ] Validate all input parameters
- [ ] Sanitize user inputs
- [ ] Rate limit API endpoints
- [ ] Implement authentication if needed (API keys)
- [ ] Don't expose private keys or sensitive data
- [ ] Validate transaction parameters before building
- [ ] Check for reentrancy in contract calls (if applicable)

---

## 9. Testing Requirements

### Unit Tests
- [ ] Test approval calculation logic
- [ ] Test LP position calldata generation
- [ ] Test amount calculations
- [ ] Test slippage application
- [ ] Test error handling

### Integration Tests
- [ ] Test with real RPC endpoints (testnet)
- [ ] Test with actual token contracts
- [ ] Test transaction simulation
- [ ] Test gas estimation

### End-to-End Tests
- [ ] Test full flow: approval → create position
- [ ] Test with frontend integration
- [ ] Test on multiple chains
- [ ] Test error scenarios

---

## 10. Deployment

### Infrastructure
- [ ] Set up server (AWS, GCP, Azure, or self-hosted)
- [ ] Configure load balancer if needed
- [ ] Set up monitoring and logging
- [ ] Configure auto-scaling if needed

### Environment Variables
- [ ] RPC endpoint URLs per chain
- [ ] Contract addresses per chain
- [ ] API keys for RPC providers
- [ ] CORS allowed origins
- [ ] Logging level

### Monitoring
- [ ] Set up error tracking (Sentry, etc.)
- [ ] Monitor API response times
- [ ] Monitor RPC call success rates
- [ ] Set up alerts for failures

---

## 11. Documentation

- [ ] Document all endpoints
- [ ] Document request/response formats
- [ ] Document error codes
- [ ] Provide example requests/responses
- [ ] Document deployment process

---

## Quick Start Example

### Minimal Node.js/Express Implementation

```javascript
// Example structure
const express = require('express');
const { ethers } = require('ethers');

const app = express();
app.use(express.json());
app.use(cors());

// RPC provider
const provider = new ethers.JsonRpcProvider('YOUR_RPC_URL');

// Router contract ABI (simplified)
const ROUTER_ABI = [/* Router ABI */];
const routerAddress = 'YOUR_ROUTER_ADDRESS';

app.post('/v1/lp/approve', async (req, res) => {
  try {
    const { walletAddress, token0, token1, amount0, amount1, chainId } = req.body;
    
    // Check allowances and generate approval transactions
    // ... implementation
    
    res.json({
      token0Approval: approvalCalldata0,
      token1Approval: approvalCalldata1,
      // ... other fields
    });
  } catch (error) {
    res.status(400).json({ detail: error.message });
  }
});

app.post('/v1/lp/create', async (req, res) => {
  try {
    const { walletAddress, token0, token1, independentAmount, independentToken, chainId } = req.body;
    
    // Calculate dependent amount
    // Build transaction calldata
    // ... implementation
    
    res.json({
      create: {
        to: routerAddress,
        data: calldata,
        value: '0',
        chainId: chainId,
        gas: gasEstimate,
      },
      dependentAmount: calculatedAmount,
      sqrtRatioX96: currentPrice,
      gasFee: gasFeeEstimate,
    });
  } catch (error) {
    res.status(400).json({ detail: error.message });
  }
});

app.listen(8080);
```

---

## Key Files to Reference in Codebase

1. **Request/Response Types**: `packages/api/src/clients/trading/__generated__/`
2. **Request Building**: `apps/web/src/pages/CreatePosition/CreatePositionTxContext.tsx`
   - `generateAddLiquidityApprovalParams()` - Shows approval request structure
   - `generateCreateCalldataQueryParams()` - Shows create request structure
3. **API Client**: `packages/api/src/clients/trading/createTradingApiClient.ts`
   - Shows exact endpoint paths and methods
4. **Response Handling**: `apps/web/src/pages/CreatePosition/CreatePositionTxContext.tsx`
   - `generateCreatePositionTxRequest()` - Shows how responses are used

---

## Priority Order

1. **Start with `/v1/lp/approve`** - Simpler, needed first
2. **Then `/v1/lp/create`** - Core functionality
3. **Add `/v1/quote`** - Helps with amount calculations
4. **Add other endpoints** - As needed for full functionality

---

## Notes

- Amounts are always strings (BigInt) to avoid precision loss
- All addresses should be checksummed (EIP-55)
- Chain IDs must match standard chain IDs
- Gas estimates should be conservative (add buffer)
- Test thoroughly on testnets before mainnet



