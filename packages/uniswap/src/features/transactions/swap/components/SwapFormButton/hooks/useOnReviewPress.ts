import { useEffect } from 'react'
import { useSwapFormWarningStoreActions } from 'uniswap/src/features/transactions/swap/form/stores/swapFormWarningStore/useSwapFormWarningStore'
import { usePrepareSwap } from 'uniswap/src/features/transactions/swap/services/hooks/usePrepareSwap'
import { useWarningService } from 'uniswap/src/features/transactions/swap/services/hooks/useWarningService'
import { isOnChainOnlyChain } from 'uniswap/src/features/transactions/swap/services/onchainRouter/config'
import { useSwapFormStoreDerivedSwapInfo } from 'uniswap/src/features/transactions/swap/stores/swapFormStore/useSwapFormStore'
import { boundaryLog } from 'uniswap/src/utils/boundaryLog'
import { useEvent } from 'utilities/src/react/hooks'

type CallbackArgs = Record<
  'skipBridgingWarning' | 'skipTokenProtectionWarning' | 'skipMaxTransferWarning' | 'skipBridgedAssetWarning',
  boolean
>

export type OnReviewPress = (options: CallbackArgs) => void

type PressHandler = () => void

type UseOnReviewPress = (source?: string) => {
  onReviewPress: OnReviewPress
  handleOnReviewPress: PressHandler
  handleOnAcknowledgeTokenWarningPress: PressHandler
  handleOnAcknowledgeLowNativeBalancePress: PressHandler
  handleOnAcknowledgeBridgedAssetPress: PressHandler
}

/**
 * TODO(WALL-5600): refactor this so all previous warnings are skipped
 *
 * Order of modals:
 * 1. Token protection warning
 * 2. Bridging warning
 * 3. Low native balance warning
 *
 * When skipping, ensure the previous modals are skipped as well to prevent an infinite loop
 * (eg if you skip bridging warning, you should also skip token protection warning)
 */
export const useOnReviewPress: UseOnReviewPress = (source?: string) => {
  const chainId = useSwapFormStoreDerivedSwapInfo((s) => s.chainId)

  // Mount log: Prove this hook is actually mounted (Base Sepolia only) - only log once per mount
  useEffect(() => {
    boundaryLog(
      `[MOUNT-0a] useOnReviewPress mounted (source=${source ?? 'unknown'})`,
      {
        tags: { file: 'useOnReviewPress', function: 'useOnReviewPress' },
        extra: { chainId, source: source ?? 'unknown' },
      },
      chainId,
    )
  }, [])

  const { handleHideTokenWarningModal, handleHideMaxNativeTransferModal, handleHideBridgedAssetModal } =
    useSwapFormWarningStoreActions()

  const warningService = useWarningService()

  const prepareSwap = usePrepareSwap({ warningService })

  const onReviewPress: OnReviewPress = useEvent(
    ({ skipBridgingWarning, skipTokenProtectionWarning, skipMaxTransferWarning, skipBridgedAssetWarning }) => {
      warningService.setSkipBridgingWarning(skipBridgingWarning)
      warningService.setSkipMaxTransferWarning(skipMaxTransferWarning)
      warningService.setSkipTokenProtectionWarning(skipTokenProtectionWarning)
      warningService.setSkipBridgedAssetWarning(skipBridgedAssetWarning)
      prepareSwap()
    },
  )

  const isOnChainOnly = chainId ? isOnChainOnlyChain(chainId) : false

  const handleOnReviewPress: PressHandler = useEvent(() => {
    // Boundary log 0a: Review Swap button click (opens review modal) - Base Sepolia only
    boundaryLog(
      '[BOUNDARY-0a][CTA] review-swap-button-click',
      {
        tags: { file: 'useOnReviewPress', function: 'handleOnReviewPress' },
        extra: {
          chainId,
          isOnChainOnly,
          source: source ?? 'unknown',
        },
      },
      chainId,
    )
    onReviewPress({
      skipBridgingWarning: false,
      skipMaxTransferWarning: false,
      skipTokenProtectionWarning: false,
      skipBridgedAssetWarning: false,
    })
  })

  const handleOnAcknowledgeTokenWarningPress: PressHandler = useEvent(() => {
    handleHideTokenWarningModal()
    onReviewPress({
      skipBridgingWarning: false,
      skipMaxTransferWarning: false,
      skipTokenProtectionWarning: true,
      skipBridgedAssetWarning: false,
    })
  })

  const handleOnAcknowledgeLowNativeBalancePress: PressHandler = useEvent(() => {
    handleHideMaxNativeTransferModal()
    onReviewPress({
      skipBridgingWarning: true,
      skipMaxTransferWarning: true,
      skipTokenProtectionWarning: true,
      skipBridgedAssetWarning: false,
    })
  })

  // Note: these warnings are ordered so we can skip everything but the bridged asset warning
  const handleOnAcknowledgeBridgedAssetPress: PressHandler = useEvent(() => {
    handleHideBridgedAssetModal()
    onReviewPress({
      skipBridgingWarning: true,
      skipMaxTransferWarning: true,
      skipTokenProtectionWarning: true,
      skipBridgedAssetWarning: true,
    })
  })

  return {
    onReviewPress,
    handleOnReviewPress,
    handleOnAcknowledgeTokenWarningPress,
    handleOnAcknowledgeLowNativeBalancePress,
    handleOnAcknowledgeBridgedAssetPress,
  }
}
